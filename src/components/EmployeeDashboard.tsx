import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { db, messaging } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, getDocs, orderBy, limit, setDoc } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';
import { UserProfile, Location, AttendanceRecord, LeaveRequest, ManualAttendanceRequest } from '../types';
import { isWithinGeofence, calculateDistance } from '../lib/geofencing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, Camera, LogOut, Calendar as CalendarIcon, Clock, CheckCircle2, AlertCircle, Loader2, Send, HelpCircle, Bell, ShieldCheck, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import Webcam from 'react-webcam';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { calculateTotalHours, calculateTotalHoursNumeric } from '../lib/attendanceUtils';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrorHandler';
import { Calendar as ReactCalendar } from 'react-calendar';
import { COMPANY_LOGO_URL, APP_NAME } from '../constants';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import 'react-calendar/dist/Calendar.css';

export function EmployeeDashboard({ 
  profile, 
  currentView, 
  setView 
}: { 
  profile: UserProfile;
  currentView: 'admin' | 'employee';
  setView: (view: 'admin' | 'employee') => void;
}) {
  const { t } = useTranslation();
  const isAdmin = profile.role === 'admin' || profile.role === 'manager';
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [activeSession, setActiveSession] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [manualRequests, setManualRequests] = useState<ManualAttendanceRequest[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const webcamRef = useRef<Webcam>(null);
  const [imageError, setImageError] = useState(false);

  // Manual Request Form
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualType, setManualType] = useState<ManualAttendanceRequest['type']>('check-in');
  const [manualLocationId, setManualLocationId] = useState('');
  const [manualTime, setManualTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [manualOutTime, setManualOutTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [manualReason, setManualReason] = useState('');
  const [manualHours, setManualHours] = useState('');

  // Leave Request Form
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [extraBreakMinutes, setExtraBreakMinutes] = useState<string>('0');
  const [now, setNow] = useState(new Date());
  const [isDayOff, setIsDayOff] = useState(profile.dayOffDate === format(new Date(), 'yyyy-MM-dd'));
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [weeklyHours, setWeeklyHours] = useState(0);

  // Helper for safe date formatting
  const safeFormat = (dateInput: any, formatStr: string) => {
    if (!dateInput) return '--';
    let d: Date;
    if (typeof dateInput.toDate === 'function') {
      d = dateInput.toDate();
    } else {
      d = new Date(dateInput);
    }
    if (isNaN(d.getTime())) return '--';
    try {
      return format(d, formatStr);
    } catch {
      return '--';
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(3)), (snapshot) => {
      setAnnouncements(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = endOfWeek(new Date(), { weekStartsOn: 1 });
    const q = query(
      collection(db, 'attendance'),
      where('userId', '==', profile.uid),
      where('status', '==', 'completed')
    );
    
    const unsub = onSnapshot(q, (snapshot) => {
      let total = 0;
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (!data.checkInTime) return;
        const checkIn = new Date(data.checkInTime);
        if (isNaN(checkIn.getTime())) return;
        
        try {
          if (isWithinInterval(checkIn, { start, end })) {
            total += calculateTotalHoursNumeric(data.checkInTime, data.checkOutTime, data.additionalBreakMinutes);
          }
        } catch { }
      });
      setWeeklyHours(total || 0);
    });
    return () => unsub();
  }, [profile.uid]);
  const lastAutomationRef = useRef<string>('');
  const tabsContentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState('attendance');

  useEffect(() => {
    if (tabsContentRef.current) {
      tabsContentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeTab]);

  // Handle FCM Token & Permissions
  useEffect(() => {
    if (!messaging) return;

    const setupNotifications = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          setNotificationsEnabled(true);
          // Note: You must generate a VAPID key in Firebase Console -> Cloud Messaging
          const token = await getToken(messaging, { 
            vapidKey: 'BMvBC8u1VvX8I2x1v5-Wv_F8M-aN_f6oXJID_O9q4m_X6f_f8M-aN_f6oXJID_O9q4m_X6f_f8M-aN_f6oXJID_O9q' // Placeholder
          }).catch(err => {
            console.warn('FCM token retrieval failed. FCM might not be fully configured.', err);
            return null;
          });

          if (token) {
            setFcmToken(token);
            // Store token in user document
            await setDoc(doc(db, 'users', profile.uid), { 
              fcmToken: token,
              lastTokenUpdate: new Date().toISOString()
            }, { merge: true });
          }
        } else {
          setNotificationsEnabled(false);
        }
      } catch (error) {
        console.error('Error setting up notifications:', error);
      }
    };

    setupNotifications();

    const unsubscribeOnMessage = onMessage(messaging, (payload) => {
      console.log('Foreground message received:', payload);
      if (payload.notification) {
        toast.info(payload.notification.title, {
          description: payload.notification.body,
          duration: 10000,
        });
      }
    });

    return () => unsubscribeOnMessage();
  }, [profile.uid]);

  // Check-in/Check-out Reminders
  useEffect(() => {
    if (!notificationsEnabled) return;

    const checkReminders = () => {
      const currentTime = format(new Date(), 'HH:mm');
      const dayOfWeek = new Date().getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      
      if (!isWeekday || profile.dayOffDate === format(new Date(), 'yyyy-MM-dd')) return;

      // Check-in reminder at 08:05 if not checked in
      if (currentTime === '08:05' && !activeSession) {
        const reminderSentKey = `reminder_in_${format(new Date(), 'yyyy-MM-dd')}`;
        if (!localStorage.getItem(reminderSentKey)) {
          new Notification(t('Check-in Reminder'), {
            body: t('You have not checked in for work yet. Please check in if you are at a work location.'),
            icon: '/favicon.ico'
          });
          localStorage.setItem(reminderSentKey, 'true');
        }
      }

      // Check-out reminder at 17:05 if still active
      if (currentTime === '17:05' && activeSession) {
        const reminderOutKey = `reminder_out_${format(new Date(), 'yyyy-MM-dd')}`;
        if (!localStorage.getItem(reminderOutKey)) {
          new Notification(t('Check-out Reminder'), {
            body: t('Your shift has ended. Don\'t forget to check out!'),
            icon: '/favicon.ico'
          });
          localStorage.setItem(reminderOutKey, 'true');
        }
      }
    };

    const interval = setInterval(checkReminders, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [notificationsEnabled, activeSession, profile.dayOffDate, t]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const triggerAudit = async (type: 'check-in-missed' | 'check-out-missed') => {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });
      
      const { latitude: lat, longitude: lng } = pos.coords;
      
      let minDistance = Infinity;
      let nearestLoc: Location | null = null;
      
      locations.forEach(loc => {
        const dist = calculateDistance(lat, lng, loc.latitude, loc.longitude);
        if (dist < minDistance) {
          minDistance = dist;
          nearestLoc = loc;
        }
      });

      const isInPerimeter = nearestLoc ? minDistance <= nearestLoc.radius : false;

      if (!isInPerimeter) {
        await addDoc(collection(db, 'locationAudits'), {
          userId: profile.uid,
          userName: profile.displayName,
          email: profile.email,
          time: new Date().toISOString(),
          type: type,
          location: { lat, lng },
          distanceFromGeofence: Math.round(minDistance),
          nearestLocationName: nearestLoc ? (nearestLoc as Location).name : 'Unknown'
        });
        toast.warning(`${t('Automatic Audit')}: ${t('You are currently outside your workspace perimeter at')} ${type === 'check-in-missed' ? '08:00' : '17:00'}. ${t('Audit log recorded')}.`, {
          duration: 10000
        });
      }
    } catch (e) {
      console.error('Audit failed', e);
    }
  };

  // Automated Audit (Mon-Fri)
  useEffect(() => {
    const dayOfWeek = now.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    if (!isWeekday) return;

    const todayStr = format(now, 'yyyy-MM-dd');
    const currentTime = format(now, 'HH:mm');
    
    const isDayOffToday = profile.dayOffDate === todayStr;
    if (isDayOffToday) return;

    // Use localStorage to ensure we only audit once per day per type
    const auditInKey = `audit_in_${todayStr}`;
    const auditOutKey = `audit_out_${todayStr}`;

    // 08:00 Audit - Missing Check-in (Catch-up if app opened later)
    if (currentTime >= '08:00' && currentTime < '17:00' && !activeSession && !localStorage.getItem(auditInKey)) {
      const alreadyCheckedInToday = history.some(h => {
        if (!h.checkInTime) return false;
        try {
          let d: Date;
          if (typeof h.checkInTime === 'object' && typeof (h.checkInTime as any).toDate === 'function') {
            d = (h.checkInTime as any).toDate();
          } else {
            d = parseISO(h.checkInTime as string);
          }
          return isSameDay(d, now);
        } catch {
          return false;
        }
      });
      if (!alreadyCheckedInToday) {
        localStorage.setItem(auditInKey, 'true');
        triggerAudit('check-in-missed');
      }
    }

    // 17:00 Audit - Missing Check-out
    if (currentTime >= '17:00' && activeSession && !localStorage.getItem(auditOutKey)) {
      localStorage.setItem(auditOutKey, 'true');
      triggerAudit('check-out-missed');
    }
  }, [now, profile, activeSession, history, locations]);

  useEffect(() => {
    // Fetch locations
    const unsubLocs = onSnapshot(collection(db, 'locations'), (snapshot) => {
      setLocations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Location)));
    });

    // Fetch active session
    const qActive = query(
      collection(db, 'attendance'),
      where('userId', '==', profile.uid),
      where('status', '==', 'active'),
      limit(1)
    );
    const unsubActive = onSnapshot(qActive, (snapshot) => {
      if (!snapshot.empty) {
        setActiveSession({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as AttendanceRecord);
      } else {
        setActiveSession(null);
      }
    });

    // Fetch history
    const qHistory = query(
      collection(db, 'attendance'),
      where('userId', '==', profile.uid),
      orderBy('checkInTime', 'desc'),
      limit(10)
    );
    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      setHistory(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
    });

    // Fetch leave requests
    const qLeave = query(
      collection(db, 'leaveRequests'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubLeave = onSnapshot(qLeave, (snapshot) => {
      const requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
      
      // Check for status changes (Push Notification simulation)
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'modified') {
          const data = change.doc.data() as LeaveRequest;
          if (data.status !== 'pending') {
            const message = `${t('Leave Request Update')}: ${t('Your request for')} ${data.startDate} ${t('has been')} ${t(data.status)}.`;
            toast.info(message, {
              duration: 5000,
            });
            if (notificationsEnabled) {
              new Notification(t('Leave Request Update'), {
                body: message,
                icon: '/favicon.ico'
              });
            }
          }
        }
      });
      
      setLeaveRequests(requests);
    });

    // Fetch manual requests
    const qManual = query(
      collection(db, 'manualAttendanceRequests'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubManual = onSnapshot(qManual, (snapshot) => {
      setManualRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ManualAttendanceRequest)));
    }, (err) => {
      console.error('Snapshot error (manualRequests)', err);
    });

    return () => {
      unsubLocs();
      unsubActive();
      unsubHistory();
      unsubLeave();
      unsubManual();
    };
  }, [profile.uid]);

  const submitManualRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualLocationId) return toast.error(t('Please select a location'));
    if (!manualTime) return toast.error(t('Please select a date and time'));
    if (manualType === 'full-shift' && !manualOutTime) return toast.error(t('Please select a check-out time'));
    if (!manualReason.trim()) return toast.error(t('Please provide a reason for this request'));

    if (manualType === 'additional-hours' && !manualHours) return toast.error(t('Please enter hours worked'));

    const location = locations.find(l => l.id === manualLocationId);
    
    // Robust date parsing
    const requestedDate = new Date(manualTime);
    if (isNaN(requestedDate.getTime())) {
      toast.error(t('Invalid date or time provided'));
      setIsProcessing(false);
      return;
    }

    const requestData: any = {
      userId: profile.uid,
      userName: profile.displayName,
      type: manualType,
      requestedTime: requestedDate.toISOString(),
      reason: manualReason,
      locationId: manualLocationId,
      locationName: location?.name || 'Unknown',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    if (manualType === 'full-shift') {
      const outDate = new Date(manualOutTime);
      if (isNaN(outDate.getTime())) {
        toast.error(t('Invalid check-out time provided'));
        setIsProcessing(false);
        return;
      }
      requestData.requestedOutTime = outDate.toISOString();
    }

    if (manualType === 'additional-hours') {
      requestData.hours = parseFloat(manualHours);
    }

    if (manualType === 'check-out' && !activeSession) {
      toast.error(t('No active session found to check out from'));
      return;
    }

    if (manualType === 'check-out' && activeSession) {
      requestData.attendanceId = activeSession.id;
    }

    setIsProcessing(true);
    try {
      await addDoc(collection(db, 'manualAttendanceRequests'), requestData);
      toast.success(t('Manual request submitted for approval'));
      setShowManualDialog(false);
      setManualReason('');
      setManualHours('');
    } catch (error: any) {
      console.error('Manual request error:', error);
      toast.error(t('Failed to submit request. Please check your connection and try again.'));
      try {
        handleFirestoreError(error, OperationType.CREATE, 'manualAttendanceRequests');
      } catch (e) {
        // Essential to prevent crashing the UI while still satisfying the requirement to throw
        console.error('Handled Firestore error info:', e);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckIn = async () => {
    if (!selectedLocationId) return toast.error(t('Select work location'));
    const location = locations.find(l => l.id === selectedLocationId);
    if (!location) return;

    setIsProcessing(true);
    try {
      // 1. Get Geolocation
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });

      // 2. Check Geofence
      const distance = calculateDistance(
        pos.coords.latitude,
        pos.coords.longitude,
        location.latitude,
        location.longitude
      );

      if (distance > location.radius) {
        setIsProcessing(false);
        return toast.error(`${t('You are too far from')} ${location.name}. ${t('Current distance')}: ${Math.round(distance)}m (${t('Allowed')}: ${location.radius}m).`);
      }

      // 3. Capture Selfie
      setIsCapturing(true);
      // Wait for user to take photo
    } catch (error: any) {
      console.error('Checkin geolocation error:', error);
      let message = t('Failed to get your location.');
      if (error.code === 1) message = t('Location access denied. Please enable GPS.');
      else if (error.code === 2) message = t('Location unavailable.');
      else if (error.code === 3) message = t('Location request timed out.');
      
      toast.error(message);
      setIsProcessing(false);
    }
  };

  const getDeviceInfo = () => {
    const ua = navigator.userAgent;
    let device = "Unknown Device";
    
    if (/android/i.test(ua)) {
      const match = ua.match(/Android\s+([^\s;]+|[^;]+);\s+([^;)]+)/);
      device = match ? `Android (${match[2]})` : "Android Device";
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      device = "iOS Device";
    } else if (/Windows/i.test(ua)) {
      device = "Windows PC";
    } else if (/Macintosh/i.test(ua)) {
      device = "Mac";
    }
    
    return device;
  };

  const confirmCheckIn = async (photo: string) => {
    setIsCapturing(false);
    const location = locations.find(l => l.id === selectedLocationId)!;
    
    // Get position again for accuracy
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });

      const record: Omit<AttendanceRecord, 'id'> = {
        userId: profile.uid,
        userName: profile.displayName,
        locationId: location.id,
        locationName: location.name,
        checkInTime: new Date().toISOString(),
        checkInPhoto: photo,
        checkInLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        checkInDevice: getDeviceInfo(),
        status: 'active'
      };

      await addDoc(collection(db, 'attendance'), record);
      toast.success(t('Checked in successfully!'));
    } catch (error) {
      console.error('Confirm checkin error:', error);
      if (error instanceof Error && error.message.includes('permission')) {
        handleFirestoreError(error, OperationType.CREATE, 'attendance');
      }
      toast.error(t('Failed to save check-in. Please try again.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckOut = async () => {
    if (!activeSession) return;
    setIsProcessing(true);
    
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });

      const location = locations.find(l => l.id === activeSession.locationId);
      if (location) {
        const distance = calculateDistance(
          pos.coords.latitude,
          pos.coords.longitude,
          location.latitude,
          location.longitude
        );
        
        if (distance > location.radius) {
          setIsProcessing(false);
          return toast.error(`${t('You are too far from')} ${location.name}. ${t('Current distance')}: ${Math.round(distance)}m (${t('Allowed')}: ${location.radius}m).`);
        }
      }

      setIsCapturing(true);
    } catch (error: any) {
      console.error('Checkout geolocation error:', error);
      let message = t('Failed to get your location.');
      if (error.code === 1) message = t('Location access denied. Please enable GPS.');
      else if (error.code === 2) message = t('Location unavailable.');
      else if (error.code === 3) message = t('Location request timed out.');
      
      toast.error(message);
      setIsProcessing(false);
    }
  };

  const confirmCheckOut = async (photo: string) => {
    setIsCapturing(false);
    setIsProcessing(true);
    
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });

      await updateDoc(doc(db, 'attendance', activeSession!.id), {
        checkOutTime: new Date().toISOString(),
        checkOutPhoto: photo,
        checkOutLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        checkOutDevice: getDeviceInfo(),
        additionalBreakMinutes: parseInt(extraBreakMinutes) || 0,
        status: 'completed'
      });

      toast.success(t('Checked out successfully!'));
      setExtraBreakMinutes('0');
    } catch (error) {
      console.error('Confirm checkout error:', error);
      if (error instanceof Error && error.message.includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `attendance/${activeSession?.id}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDayOff = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const newState = !isDayOff;
    setIsDayOff(newState);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        dayOffDate: newState ? today : null
      });
      toast.success(newState ? t('Enjoy your day off!') : t('Welcome back to work!'));
    } catch (e) {
      toast.error(t('Error'));
    }
  };

  const submitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveStart) return toast.error(t('Please select a start date'));
    if (!leaveEnd) return toast.error(t('Please select an end date'));
    if (!leaveReason.trim()) return toast.error(t('Please provide a reason for your leave'));

    const request: Omit<LeaveRequest, 'id'> = {
      userId: profile.uid,
      userName: profile.displayName,
      startDate: leaveStart,
      endDate: leaveEnd,
      reason: leaveReason,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'leaveRequests'), request);
      toast.success(t('Leave request submitted'));
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
    } catch (error) {
      console.error('Failed to submit leave request:', error);
      toast.error(t('Failed to submit request'));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8 transition-colors duration-300">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center p-2">
              {!imageError ? (
                <img 
                  src={COMPANY_LOGO_URL} 
                  alt={APP_NAME} 
                  className="max-h-full max-w-full object-contain"
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="text-zinc-400 dark:text-zinc-500 font-bold text-xs text-center leading-tight">
                  {APP_NAME}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t('Welcome')}, {profile.displayName}</h1>
              <p className="text-zinc-500 dark:text-zinc-400">{t('Manage your attendance and time off.')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            
            {isAdmin && (
              <div className="flex bg-zinc-200/50 dark:bg-zinc-800/50 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 mr-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={cn(
                    "h-8 px-3 text-xs font-bold transition-all rounded-md flex items-center gap-2",
                    currentView === 'admin' 
                      ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm" 
                      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-900/50"
                  )}
                  onClick={() => setView('admin')}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t('Admin View')}
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={cn(
                    "h-8 px-3 text-xs font-bold transition-all rounded-md flex items-center gap-2",
                    currentView === 'employee' 
                      ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm" 
                      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-zinc-900/50"
                  )}
                  onClick={() => setView('employee')}
                >
                  <User className="h-3.5 w-3.5" />
                  {t('Employee View')}
                </Button>
              </div>
            )}
            
            <Button 
              variant={isDayOff ? "default" : "outline"} 
              size="sm"
              onClick={handleDayOff}
              className={isDayOff ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-zinc-200 dark:border-zinc-800 dark:hover:bg-zinc-900"}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {isDayOff ? t('On Day Off') : t('Mark Day Off')}
            </Button>
            <Badge variant="outline" className="px-3 py-1 capitalize dark:border-zinc-800">
              {profile.role}
            </Badge>
            <div className="flex items-center gap-2">
              <Badge 
                variant={notificationsEnabled ? "default" : "secondary"}
                className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${notificationsEnabled ? 'bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'}`}
              >
                {notificationsEnabled ? t('Push Active') : t('Push Disabled')}
              </Badge>
            </div>
          </div>
        </header>

        <div className="max-w-4xl mx-auto space-y-6">
          {/* Announcements */}
          {announcements.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {announcements.map((ann) => (
                <div key={ann.id} className="bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 p-4 rounded-xl flex gap-3 items-start animate-in fade-in slide-in-from-top-4 duration-500">
                  <div className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded-lg">
                    <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider">{t('New Announcement')}</h4>
                    <p className="text-sm text-amber-800 dark:text-amber-100 font-medium leading-relaxed">{ann.message}</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-500 font-medium">{safeFormat(ann.createdAt, 'HH:mm, MMM d')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Weekly Summary Card */}
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-1 bg-zinc-900 text-white border-none shadow-xl overflow-hidden group">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-zinc-400 text-xs font-bold uppercase tracking-widest">{t('Weekly Total')}</CardTitle>
                  <Badge variant="outline" className="text-zinc-500 border-zinc-800 text-[10px]">{t('This Week')}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black tracking-tighter tabular-nums">{weeklyHours.toFixed(1)}</span>
                  <span className="text-zinc-500 font-bold uppercase text-xs">{t('Hours')}</span>
                </div>
                
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-zinc-500">{t('Progress')}</span>
                    <span className="text-zinc-400">{Math.min(100, Math.round((weeklyHours / 40) * 100))}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${Math.min(100, (weeklyHours / 40) * 100)}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="md:col-span-2">
              <div ref={tabsContentRef}>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
           <TabsList className="grid w-full grid-cols-2 bg-zinc-100 dark:bg-zinc-900 p-1 border border-zinc-200 dark:border-zinc-800">
             <TabsTrigger value="attendance" className="dark:text-zinc-400 dark:data-[state=active]:bg-zinc-800 dark:data-[state=active]:text-zinc-100">{t('Attendance')}</TabsTrigger>
             <TabsTrigger value="leave" className="dark:text-zinc-400 dark:data-[state=active]:bg-zinc-800 dark:data-[state=active]:text-zinc-100">{t('Leave Requests')}</TabsTrigger>
           </TabsList>

          <TabsContent value="attendance" className="mt-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Check-in/out Card */}
              <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 dark:text-zinc-100">
                    <Clock className="h-5 w-5" />
                    {activeSession ? t('Active Session') : t('New Session')}
                  </CardTitle>
                  <CardDescription className="dark:text-zinc-400">
                    {activeSession 
                      ? `${t('Currently at')} ${activeSession.locationName}` 
                      : t('Select a location to start your shift.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!activeSession ? (
                    <>
                      <div className="space-y-2">
                        <Label className="dark:text-zinc-200">{t('Location')}</Label>
                        <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                          <SelectTrigger className="dark:bg-zinc-950 dark:border-zinc-800">
                            <SelectValue placeholder={t('Select work location')} />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map(loc => (
                              <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button 
                        onClick={handleCheckIn} 
                        disabled={isProcessing}
                        className="w-full bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
                        {t('Check In')}
                      </Button>

                        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 group border border-dashed border-zinc-200 dark:border-zinc-800"
                            onClick={() => {
                              if (selectedLocationId) {
                                setManualLocationId(selectedLocationId);
                              }
                              setManualTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                              setManualType('check-in');
                              setShowManualDialog(true);
                            }}
                          >
                            <HelpCircle className="mr-2 h-4 w-4 group-hover:animate-pulse" />
                            {t('Manual Time Entry / Forgot to check in?')}
                          </Button>
                        </div>
                      </>
                    ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800 p-4">
                          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('Started at')}</p>
                          <p className="text-xl font-bold dark:text-zinc-100">{safeFormat(activeSession.checkInTime, 'hh:mm a')}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-4 border border-emerald-100 dark:border-emerald-900/30">
                          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{t('Net Hours')}</p>
                          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                            {calculateTotalHours(activeSession.checkInTime, now.toISOString(), parseInt(extraBreakMinutes) || 0)}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-zinc-500">{t('Additional Break Time (Minutes)')}</Label>
                        <Input 
                          type="number" 
                          placeholder="0" 
                          value={extraBreakMinutes} 
                          onChange={e => setExtraBreakMinutes(e.target.value)}
                        />
                        <p className="text-[10px] text-zinc-400">{t('1 hour standard break is already deducted automatically.')}</p>
                      </div>

                      <Button 
                        onClick={handleCheckOut} 
                        disabled={isProcessing}
                        variant="destructive"
                        className="w-full"
                      >
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                        {t('Check Out')}
                      </Button>

                      <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 text-center">
                        <Button 
                          variant="link" 
                          className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                          onClick={() => {
                            setManualType('check-out');
                            setManualLocationId(activeSession.locationId);
                            setManualTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                            setShowManualDialog(true);
                          }}
                        >
                           {t('Request Manual Check-out')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Manual Attendance Request Dialog (Universal) */}
              <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
                <DialogContent className="dark:bg-zinc-900 dark:border-zinc-800">
                  <DialogHeader>
                    <DialogTitle className="dark:text-zinc-100">
                      {manualType === 'additional-hours' ? t('Request Additional Hours') : 
                       manualType === 'check-out' ? t('Request Manual Check-out') :
                       manualType === 'full-shift' ? t('Manual Entry (In & Out)') :
                       t('Manual Check-in Request')}
                    </DialogTitle>
                    <DialogDescription className="dark:text-zinc-400">
                      {manualType === 'additional-hours' 
                        ? t('Request manual hours entry for work performed outside the app.')
                        : t('Please provide the exact time and a reason for this manual entry.')}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={submitManualRequest} className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label className="dark:text-zinc-200">{t('Request Type')}</Label>
                      <Select value={manualType} onValueChange={(v: any) => setManualType(v)}>
                        <SelectTrigger className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="dark:bg-zinc-900 dark:border-zinc-800">
                          <SelectItem value="check-in" className="dark:text-zinc-200 dark:focus:bg-zinc-800">{t('Check In')}</SelectItem>
                          <SelectItem value="check-out" className="dark:text-zinc-200 dark:focus:bg-zinc-800">{t('Check Out')}</SelectItem>
                          <SelectItem value="full-shift" className="dark:text-zinc-200 dark:focus:bg-zinc-800">{t('Manual Entry (In & Out)')}</SelectItem>
                          <SelectItem value="additional-hours" className="dark:text-zinc-200 dark:focus:bg-zinc-800">{t('Additional Hours')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="dark:text-zinc-200">{t('Location')}</Label>
                      <Select value={manualLocationId} onValueChange={setManualLocationId}>
                        <SelectTrigger className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100">
                          <SelectValue placeholder={t('Select location')} />
                        </SelectTrigger>
                        <SelectContent className="dark:bg-zinc-900 dark:border-zinc-800">
                          {locations.map(loc => (
                            <SelectItem key={loc.id} value={loc.id} className="dark:text-zinc-200 dark:focus:bg-zinc-800">{loc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {manualType === 'additional-hours' && (
                      <div className="space-y-2">
                        <Label className="dark:text-zinc-200">{t('Hours to record')}</Label>
                        <Input 
                          type="number" 
                          step="0.5"
                          placeholder={t('How many hours?')} 
                          value={manualHours} 
                          onChange={e => setManualHours(e.target.value)} 
                          required
                          className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="dark:text-zinc-200">
                        {manualType === 'full-shift' ? t('Check In Date & Time') : t('Date & Time')}
                      </Label>
                      <Input 
                        type="datetime-local" 
                        value={manualTime} 
                        onChange={e => setManualTime(e.target.value)} 
                        required
                        className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                      />
                    </div>

                    {manualType === 'full-shift' && (
                      <div className="space-y-2">
                        <Label className="dark:text-zinc-200">{t('Check Out Date & Time')}</Label>
                        <Input 
                          type="datetime-local" 
                          value={manualOutTime} 
                          onChange={e => setManualOutTime(e.target.value)} 
                          required
                          className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="dark:text-zinc-200">{t('Reason / Description')}</Label>
                      <Input 
                        placeholder={t('e.g. Outside geo-zone, Forgot phone...')} 
                        value={manualReason} 
                        onChange={e => setManualReason(e.target.value)} 
                        required
                        className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                      />
                    </div>
                    <DialogFooter>
                      <Button 
                        type="submit" 
                        disabled={isProcessing}
                        className="bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 w-full sm:w-auto"
                      >
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : t('Submit Request')}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* History Card */}
              <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarIcon className="h-5 w-5" />
                    {t('Recent History')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {history.length === 0 ? (
                      <p className="text-center text-sm text-zinc-500 py-8">{t('No recent activity.')}</p>
                    ) : (
                      history.map(record => (
                        <div key={record.id} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 last:border-0">
                          <div>
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">{record.locationName}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{safeFormat(record.checkInTime, 'MMM d, yyyy')}</p>
                          </div>
                          <div className="text-right text-sm">
                            <p className="font-mono dark:text-zinc-300">{safeFormat(record.checkInTime, 'HH:mm')} - {record.checkOutTime ? safeFormat(record.checkOutTime, 'HH:mm') : '--:--'}</p>
                            <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400">
                              {t('Total')}: {calculateTotalHours(record.checkInTime, record.checkOutTime, record.additionalBreakMinutes)}
                            </p>
                            <Badge 
                              className={`text-[10px] h-4 ${
                                record.status === 'active' 
                                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' 
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                              }`}
                              variant="outline"
                            >
                              {t(record.status)}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="leave" className="mt-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <CardHeader>
                  <CardTitle className="dark:text-zinc-100">{t('Leave Calendar')}</CardTitle>
                  <CardDescription className="dark:text-zinc-400">{t('Visualize your approved and pending leave days.')}</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <div className="custom-calendar-container w-full max-w-sm">
                    <ReactCalendar
                      tileClassName={({ date }) => {
                        try {
                          const isLeave = leaveRequests.some(req => {
                            if (!req.startDate || !req.endDate) return false;
                            const start = parseISO(req.startDate);
                            const end = parseISO(req.endDate);
                            if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
                            return isWithinInterval(date, { start, end });
                          });
                          const approved = leaveRequests.some(req => {
                            if (!req.startDate || !req.endDate) return false;
                            const start = parseISO(req.startDate);
                            const end = parseISO(req.endDate);
                            if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
                            return req.status === 'approved' && isWithinInterval(date, { start, end });
                          });
                          if (approved) return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 rounded-full font-bold';
                          if (isLeave) return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-full font-bold';
                          return '';
                        } catch {
                          return '';
                        }
                      }}
                      className="border-none shadow-none font-sans"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <CardHeader>
                  <CardTitle className="dark:text-zinc-100">{t('Request Time Off')}</CardTitle>
                  <CardDescription className="dark:text-zinc-400">{t('Submit a new leave request for approval.')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={submitLeaveRequest} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="dark:text-zinc-200">{t('Start Date')}</Label>
                        <Input 
                          type="date" 
                          value={leaveStart} 
                          onChange={e => setLeaveStart(e.target.value)} 
                          required 
                          className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="dark:text-zinc-200">{t('End Date')}</Label>
                        <Input 
                          type="date" 
                          value={leaveEnd} 
                          onChange={e => setLeaveEnd(e.target.value)} 
                          required 
                          className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="dark:text-zinc-200">{t('Reason')}</Label>
                      <Input 
                        placeholder={t('e.g. Family vacation')} 
                        value={leaveReason} 
                        onChange={e => setLeaveReason(e.target.value)} 
                        required 
                        className="dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                      />
                    </div>
                    <Button type="submit" className="w-full bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
                      {t('Submit Request')}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <CardHeader>
                  <CardTitle className="dark:text-zinc-100">{t('My Requests')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {leaveRequests.length === 0 ? (
                      <p className="text-center text-sm text-zinc-500 py-8">{t('No requests found.')}</p>
                    ) : (
                      leaveRequests.map(req => (
                        <div key={req.id} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 last:border-0">
                          <div>
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">{req.reason}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{req.startDate} to {req.endDate}</p>
                          </div>
                          <Badge 
                            className={
                              req.status === 'approved' 
                                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' 
                                : req.status === 'denied'
                                ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-red-950/40'
                                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                            }
                            variant="outline"
                          >
                            {t(req.status)}
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>
    </div>
  </div>

  {/* Camera Overlay */}
  {isCapturing && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md overflow-hidden bg-zinc-900 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t('Capture Selfie')}
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {t('Please take a photo to verify your identity.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-800">
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              screenshotQuality={0.8}
              className="h-full w-full object-cover"
              disablePictureInPicture={true}
              forceScreenshotSourceSize={false}
              imageSmoothing={true}
              mirrored={false}
              onUserMedia={() => {}}
              onUserMediaError={() => {
                toast.error('Could not access camera. Please check your permissions.');
                setIsCapturing(false);
                setIsProcessing(false);
              }}
            />
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              className="flex-1 border-zinc-700 text-zinc-900 hover:bg-zinc-800 hover:text-white"
              onClick={() => { setIsCapturing(false); setIsProcessing(false); }}
            >
              {t('Cancel')}
            </Button>
            <Button 
              className="flex-1 bg-white text-zinc-900 hover:bg-zinc-200"
              onClick={() => {
                const imageSrc = webcamRef.current?.getScreenshot();
                if (imageSrc) {
                  if (activeSession) confirmCheckOut(imageSrc);
                  else confirmCheckIn(imageSrc);
                }
              }}
            >
              {t('Capture')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )}
  </div>
</div>
);
}
