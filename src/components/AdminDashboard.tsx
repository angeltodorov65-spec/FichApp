import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { db, auth } from '../firebase';
import { collection, query, onSnapshot, updateDoc, doc, addDoc, deleteDoc, orderBy, limit, setDoc, where, getDocs } from 'firebase/firestore';
import { UserProfile, Location, AttendanceRecord, LeaveRequest, LocationAudit, ManualAttendanceRequest } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Users, MapPin, Calendar, Clock, CheckCircle2, XCircle, MoreVertical, Download, Plus, Trash2, LogOut, Loader2, Pencil, Bell, ShieldAlert, AlertTriangle, ExternalLink, ChevronDown, ChevronRight, Filter, History, HelpCircle, Check, Send, ShieldCheck, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format, differenceInHours, startOfDay, endOfDay, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { calculateTotalHours, calculateTotalHoursNumeric } from '../lib/attendanceUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import { COMPANY_LOGO_URL, APP_NAME } from '../constants';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MapSection } from './MapSection';

export function AdminDashboard({ 
  profile, 
  currentView, 
  setView 
}: { 
  profile: UserProfile;
  currentView: 'admin' | 'employee';
  setView: (view: 'admin' | 'employee') => void;
}) {
  const { t } = useTranslation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [locationAudits, setLocationAudits] = useState<LocationAudit[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [manualRequests, setManualRequests] = useState<ManualAttendanceRequest[]>([]);
  const [adjustingRequest, setAdjustingRequest] = useState<ManualAttendanceRequest | null>(null);
  const [adjustedHours, setAdjustedHours] = useState<string>('');
  const [userToDelete, setUserToDelete] = useState<{id: string, name: string} | null>(null);
  const [inviteToDelete, setInviteToDelete] = useState<string | null>(null);
  const [auditToDelete, setAuditToDelete] = useState<string | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [editLocName, setEditLocName] = useState('');
  const [editingReminders, setEditingReminders] = useState<UserProfile | null>(null);
  const [remCheckIn, setRemCheckIn] = useState<string[]>(['', '', '']);
  const [remCheckOut, setRemCheckOut] = useState<string[]>(['', '', '']);
  const [editingAttendance, setEditingAttendance] = useState<AttendanceRecord | null>(null);
  const [selectedUserHistory, setSelectedUserHistory] = useState<UserProfile | null>(null);
  const [userHistoryRecords, setUserHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editBreak, setEditBreak] = useState('0');
  const [imageError, setImageError] = useState(false);
  const tabsContentRef = useRef<HTMLDivElement>(null);

  const handleDeleteAudit = async () => {
    if (auditToDelete) {
      try {
        await deleteDoc(doc(db, 'locationAudits', auditToDelete));
        toast.success(t('Audit log deleted'));
        setAuditToDelete(null);
      } catch (error) {
        console.error('Delete audit failed', error);
        toast.error(t('Failed to delete audit log'));
      }
    }
  };

  // Location Form
  const [newLocName, setNewLocName] = useState('');
  const [newLocLat, setNewLocLat] = useState('');
  const [newLocLng, setNewLocLng] = useState('');
  const [newLocRadius, setNewLocRadius] = useState('100');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [newAnnouncement, setNewAnnouncement] = useState('');
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), (snapshot) => {
      setAnnouncements(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const handleCreateAnnouncement = async () => {
    if (!newAnnouncement.trim()) return;
    setIsPostingAnnouncement(true);
    try {
      await addDoc(collection(db, 'announcements'), {
        message: newAnnouncement,
        createdAt: new Date().toISOString(),
        authorId: auth.currentUser?.uid,
        authorName: users.find(u => u.uid === auth.currentUser?.uid)?.name || 'Admin'
      });
      setNewAnnouncement('');
      toast.success(t('Message posted successfully'));
    } catch (error) {
      console.error(error);
      toast.error(t('Error'));
    } finally {
      setIsPostingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'announcements', id));
      toast.success(t('Announcement deleted'));
    } catch (error) {
      console.error(error);
    }
  };
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearchAddress = (query: string) => {
    setSearchQuery(query);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
          headers: {
            'Accept-Language': 'en'
          }
        });
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        setSearchResults(data);
      } catch (error) {
        console.error('Search failed', error);
        toast.error(t('Location search failed. Please try again or enter coordinates manually.'));
      } finally {
        setIsSearching(false);
      }
    }, 500);
  };

  const selectSearchResult = (result: any) => {
    setNewLocName(result.display_name.split(',')[0]);
    setNewLocLat(result.lat);
    setNewLocLng(result.lon);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Invitation Form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDivision, setInviteDivision] = useState<string>('Compliance Division');
  const [inviteRole, setInviteRole] = useState<UserProfile['role']>('employee');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  // Attendance Filters
  const [activeTab, setActiveTab] = useState('attendance');
  const [attendanceView, setAttendanceView] = useState<'daily' | 'weekly'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expandedDivisions, setExpandedDivisions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (tabsContentRef.current) {
      tabsContentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeTab]);

  useEffect(() => {
    const unsubLocs = onSnapshot(collection(db, 'locations'), (snapshot) => {
      setLocations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Location)));
    }, (err) => {
      console.error('Snapshot error (locations)', err);
    });

    const qAttendance = query(collection(db, 'attendance'), orderBy('checkInTime', 'desc'), limit(500));
    const unsubAttendance = onSnapshot(qAttendance, (snapshot) => {
      setAttendance(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
    }, (err) => {
      console.error('Snapshot error (attendance)', err);
    });

    const qLeave = query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'));
    const unsubLeave = onSnapshot(qLeave, (snapshot) => {
      setLeaveRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
    }, (err) => {
      console.error('Snapshot error (leaveRequests)', err);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as unknown as UserProfile)));
    }, (err) => {
      console.error('Snapshot error (users)', err);
    });

    const unsubInvites = onSnapshot(collection(db, 'invitations'), (snapshot) => {
      setInvitations(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('Snapshot error (invitations)', err);
    });

    const qAudits = query(collection(db, 'locationAudits'), orderBy('time', 'desc'), limit(100));
    const unsubAudits = onSnapshot(qAudits, (snapshot) => {
      setLocationAudits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as LocationAudit)));
    }, (err) => {
      console.error('Snapshot error (locationAudits)', err);
    });

    const qManual = query(collection(db, 'manualAttendanceRequests'), orderBy('createdAt', 'desc'));
    const unsubManual = onSnapshot(qManual, (snapshot) => {
      setManualRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ManualAttendanceRequest)));
    }, (err) => {
      console.error('Snapshot error (manualRequests)', err);
    });

    return () => {
      unsubLocs();
      unsubAttendance();
      unsubLeave();
      unsubUsers();
      unsubInvites();
      unsubAudits();
      unsubManual();
    };
  }, []);

  // Statistics Calculations
  const today = new Date();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  // Helper for safe date parsing to prevent crashes with invalid Firestore data
  const safeDate = (dateStr: any) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  };

  // Active users: Have an active attendance
  const activeRecordsToday = attendance.filter(r => r.status === 'active');
  
  const activeUserIds = new Set(activeRecordsToday.map(r => r.userId));
  
  // Users on Day Off: Have an approved leave including today
  const dayOffUserIds = new Set(
    leaveRequests
      .filter(l => {
        if (l.status !== 'approved') return false;
        const start = safeDate(l.startDate);
        const end = safeDate(l.endDate);
        if (!start || !end) return false;
        try {
          return isWithinInterval(today, { 
            start: startOfDay(start), 
            end: endOfDay(end) 
          });
        } catch (e) {
          return false;
        }
      })
      .map(l => l.userId)
  );

  const teamStats = {
    active: activeUserIds.size,
    dayOff: dayOffUserIds.size,
    inactive: users.length - activeUserIds.size - dayOffUserIds.size
  };

  // Group active users by location for the map
  const locationStats = locations.map(loc => {
    const checkedInHere = activeRecordsToday.filter(r => r.locationId === loc.id);
    return {
      ...loc,
      count: checkedInHere.length,
      users: checkedInHere.map(r => r.userName)
    };
  });
  const toggleDivision = (division: string) => {
    setExpandedDivisions(prev => ({ ...prev, [division]: !prev[division] }));
  };

  // Filter and Group Attendance
  const filteredAttendance = attendance.filter(record => {
    const recordDate = safeDate(record.checkInTime);
    const targetDate = safeDate(selectedDate);
    if (!recordDate || !targetDate) return false;
    
    try {
      if (attendanceView === 'daily') {
        return isWithinInterval(recordDate, {
          start: startOfDay(targetDate),
          end: endOfDay(targetDate)
        });
      } else {
        return isWithinInterval(recordDate, {
          start: startOfWeek(targetDate, { weekStartsOn: 1 }),
          end: endOfWeek(targetDate, { weekStartsOn: 1 })
        });
      }
    } catch (e) {
      return false;
    }
  });

  const groupedAttendance = filteredAttendance.reduce((acc, record) => {
    const user = users.find(u => u.uid === record.userId);
    const division = user?.division || 'Unassigned';
    const role = user?.role || 'employee';

    if (!acc[division]) acc[division] = {};
    if (!acc[division][role]) acc[division][role] = [];
    
    acc[division][role].push(record);
    return acc;
  }, {} as Record<string, Record<string, AttendanceRecord[]>>);

  const handleApproveLeave = async (id: string) => {
    try {
      await updateDoc(doc(db, 'leaveRequests', id), {
        status: 'approved',
        reviewedBy: profile.displayName
      });
      toast.success('Leave request approved');
    } catch (error) {
      console.error('Failed to approve leave:', error);
      toast.error('Failed to approve leave request');
    }
  };

  const handleDenyLeave = async (id: string) => {
    try {
      await updateDoc(doc(db, 'leaveRequests', id), {
        status: 'denied',
        reviewedBy: profile.displayName
      });
      toast.error('Leave request denied');
    } catch (error) {
      console.error('Failed to deny leave:', error);
      toast.error('Failed to deny leave request');
    }
  };

  const handleManualRequest = async (request: ManualAttendanceRequest, status: 'approved' | 'denied', adjustedValue?: number) => {
    try {
      const hoursToUse = adjustedValue !== undefined ? adjustedValue : (request.hours || 0);

      if (status === 'approved') {
        if (request.type === 'check-in') {
          await addDoc(collection(db, 'attendance'), {
            userId: request.userId,
            userName: request.userName,
            locationId: request.locationId,
            locationName: request.locationName,
            checkInTime: request.requestedTime,
            status: 'active',
            isManual: true,
            manualReason: request.reason,
            approvedBy: profile.uid
          });
        } else if (request.type === 'full-shift') {
          await addDoc(collection(db, 'attendance'), {
            userId: request.userId,
            userName: request.userName,
            locationId: request.locationId,
            locationName: request.locationName,
            checkInTime: request.requestedTime,
            checkOutTime: request.requestedOutTime || request.requestedTime,
            status: 'completed',
            isManual: true,
            manualReason: request.reason,
            approvedBy: profile.uid,
            additionalBreakMinutes: 0
          });
        } else if (request.type === 'additional-hours') {
          const start = new Date(request.requestedTime);
          // calculateTotalHoursNumeric deducts 60 minutes, so we add 1 hour to the check-out time
          const end = new Date(start.getTime() + (hoursToUse + 1) * 60 * 60 * 1000);
          
          await addDoc(collection(db, 'attendance'), {
            userId: request.userId,
            userName: request.userName,
            locationId: request.locationId,
            locationName: request.locationName,
            checkInTime: start.toISOString(),
            checkOutTime: end.toISOString(),
            status: 'completed',
            isManual: true,
            manualReason: request.reason,
            approvedBy: profile.uid,
            additionalBreakMinutes: 0
          });
        } else if (request.attendanceId) {
          await updateDoc(doc(db, 'attendance', request.attendanceId), {
            checkOutTime: request.requestedTime,
            status: 'completed',
            isManual: true,
            manualReason: request.reason,
            approvedBy: profile.uid
          });
        } else {
          // If no attendanceId, try to find the latest active one for this user
          const q = query(
            collection(db, 'attendance'),
            where('userId', '==', request.userId),
            where('status', '==', 'active'),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            await updateDoc(doc(db, 'attendance', snap.docs[0].id), {
              checkOutTime: request.requestedTime,
              status: 'completed',
              isManual: true,
              manualReason: request.reason,
              approvedBy: profile.uid
            });
          } else {
            toast.error('No active session found for this user to check out.');
            return; // Exit without updating the manualAttendanceRequests document
          }
        }
      }

      await updateDoc(doc(db, 'manualAttendanceRequests', request.id), {
        status,
        processedBy: profile.displayName,
        processedAt: new Date().toISOString(),
        hours: hoursToUse // Update with adjusted hours if provided
      });
      
      toast.success(`${t('Request')} ${t(status)}`);
    } catch (error) {
      console.error('Process manual request failed', error);
      toast.error(t('Failed to process request'));
    }
  };

  const handleAddLocation = async () => {
    if (!newLocName.trim()) return toast.error(t('Please enter a location name'));
    if (!newLocLat || !newLocLng) return toast.error(t('Please search for an address or enter coordinates manually'));
    try {
      await addDoc(collection(db, 'locations'), {
        name: newLocName,
        latitude: parseFloat(newLocLat),
        longitude: parseFloat(newLocLng),
        radius: parseFloat(newLocRadius)
      });
      toast.success('Location added');
      setNewLocName('');
      setNewLocLat('');
      setNewLocLng('');
    } catch (error) {
      console.error('Failed to add location:', error);
      toast.error('Failed to add location');
    }
  };

  const handleDeleteLocation = async () => {
    if (locationToDelete) {
      try {
        await deleteDoc(doc(db, 'locations', locationToDelete));
        toast.success(t('Location deleted'));
        setLocationToDelete(null);
      } catch (error) {
        console.error('Failed to delete location:', error);
        toast.error('Failed to delete location');
      }
    }
  };

  const handleUpdateLocationName = async () => {
    if (!editingLocation || !editLocName.trim()) return;
    try {
      await updateDoc(doc(db, 'locations', editingLocation.id), {
        name: editLocName.trim()
      });
      toast.success(t('Location updated'));
      setEditingLocation(null);
    } catch (error) {
      toast.error(t('Failed to update location'));
    }
  };

  const handleUpdateRecord = async () => {
    if (!editingAttendance) return;
    try {
      const updates: any = {
        checkInTime: new Date(editCheckIn).toISOString(),
        additionalBreakMinutes: parseInt(editBreak) || 0
      };
      
      if (editCheckOut) {
        updates.checkOutTime = new Date(editCheckOut).toISOString();
        updates.status = 'completed';
      }

      await updateDoc(doc(db, 'attendance', editingAttendance.id), updates);
      toast.success(t('Attendance record updated'));
      setEditingAttendance(null);
    } catch (error) {
      toast.error(t('Failed to update record'));
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) return toast.error(t('Please enter an email address'));
    if (!inviteName.trim()) return toast.error(t('Please enter the employee name'));
    
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    // 1. Create Invitation
    await addDoc(collection(db, 'invitations'), {
      email: inviteEmail,
      invitedName: inviteName,
      division: inviteDivision,
      role: inviteRole,
      status: 'pending',
      token: token,
      createdAt: new Date().toISOString()
    });

    // 2. Create placeholder user in "invited" status
    await setDoc(doc(db, 'users', `invited_${token}`), {
      uid: `invited_${token}`,
      email: inviteEmail,
      displayName: inviteName,
      role: inviteRole,
      division: inviteDivision,
      status: 'invited',
      createdAt: new Date().toISOString()
    });
    
    let origin = window.location.origin;
    // Ensure we use the public 'ais-pre' domain instead of the restricted 'ais-dev' domain
    if (origin.includes('ais-dev-')) {
      origin = origin.replace('ais-dev-', 'ais-pre-');
    }
    
    // If we are inside AI Studio editor, the origin might be wrong.

    const inviteLink = `${origin}/?token=${token}`;
    setGeneratedInviteLink(inviteLink);
    setShowInviteDialog(true);
    navigator.clipboard.writeText(inviteLink);
    toast.info(t('Remember to click Share in the top right so the link works for others.'));
    
    setInviteEmail('');
    setInviteName('');
  };

  const handleCreateUser = async () => {
    if (!inviteEmail.trim()) return toast.error(t('Please enter an email address'));
    if (!inviteName.trim()) return toast.error(t('Please enter the employee name'));
    
    const tempId = `pre_${Date.now()}`;
    await setDoc(doc(db, 'users', tempId), {
      uid: tempId,
      email: inviteEmail,
      displayName: inviteName,
      role: inviteRole,
      division: inviteDivision,
      status: 'active',
      createdAt: new Date().toISOString()
    });
    
    toast.success('User record created directly!');
    setInviteEmail('');
    setInviteName('');
  };

  const handleUpdateReminders = async () => {
    if (!editingReminders) return;
    try {
      await updateDoc(doc(db, 'users', editingReminders.uid), {
        reminders: {
          checkIn: remCheckIn.filter(t => t),
          checkOut: remCheckOut.filter(t => t)
        }
      });
      toast.success(t('Reminders updated'));
      setEditingReminders(null);
    } catch (error) {
      toast.error(t('Failed to update reminders'));
    }
  };

  // User History Listener
  useEffect(() => {
    if (!selectedUserHistory) {
      setUserHistoryRecords([]);
      return;
    }

    setIsLoadingHistory(true);
    const q = query(
      collection(db, 'attendance'),
      orderBy('checkInTime', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as AttendanceRecord))
        .filter(r => r.userId === selectedUserHistory.uid);
      setUserHistoryRecords(records);
      setIsLoadingHistory(false);
    }, (err) => {
      console.error('Error fetching user history', err);
      toast.error(t('Failed to load user history'));
      setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [selectedUserHistory, t]);

  const handleViewUserHistory = (user: UserProfile) => {
    setSelectedUserHistory(user);
  };

  const handleDeleteInvite = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'invitations', id));
      toast.success('Invitation revoked');
      setInviteToDelete(null);
    } catch (error: any) {
      console.error('Delete invitation failed', error);
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleDeleteUser = async (userId: string, name: string) => {
    try {
      await deleteDoc(doc(db, 'users', userId));
      toast.success(`${t('User')} ${name} ${t('deleted successfully')}`);
      setUserToDelete(null);
    } catch (error: any) {
      console.error('Delete user failed', error);
      toast.error(`${t('Error')}: ${error.message}`);
    }
  };

  const handleDownloadExcel = () => {
    try {
      const dataToExport = attendance.map(record => {
        const totalHours = calculateTotalHoursNumeric(record.checkInTime, record.checkOutTime, record.additionalBreakMinutes);
        const overtime = Math.max(0, totalHours - 8);
        return {
          'Employee Name': record.userName,
          'Division': users.find(u => u.uid === record.userId)?.division || 'N/A',
          'Location': record.locationName,
          'Check-In': record.checkInTime ? format(new Date(record.checkInTime), 'yyyy-MM-dd HH:mm:ss') : '',
          'Check-Out': record.checkOutTime ? format(new Date(record.checkOutTime), 'yyyy-MM-dd HH:mm:ss') : 'Active',
          'Break (Extra min)': record.additionalBreakMinutes || 0,
          'Total Hours': calculateTotalHours(record.checkInTime, record.checkOutTime, record.additionalBreakMinutes),
          'Overtime': overtime.toFixed(1),
          'Status': record.status,
          'Manual Entry': record.isManual ? 'Yes' : 'No',
          'Reason (if manual)': record.manualReason || ''
        };
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      
      const fileName = `ERCS_Attendance_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(t('Report exported successfully'));
    } catch (error) {
      console.error('Export failed', error);
      toast.error(t('Failed to export report'));
    }
  };

  const handleDownloadLeaveReport = () => {
    try {
      const dataToExport = leaveRequests.map(req => ({
        'Employee Name': req.userName,
        'Start Date': req.startDate,
        'End Date': req.endDate,
        'Type': req.type,
        'Reason': req.reason,
        'Status': req.status,
        'Requested At': format(new Date(req.createdAt), 'yyyy-MM-dd HH:mm')
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'LeaveRequests');
      
      const fileName = `ERCS_Leave_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(t('Leave report exported successfully'));
    } catch (error) {
      console.error('Export failed', error);
      toast.error(t('Failed to export leave report'));
    }
  };

  // Stats
  const activeEmployees = attendance.filter(a => a.status === 'active').length;
  const pendingLeaves = leaveRequests.filter(l => l.status === 'pending').length;

  // Chart Data (Hours per day)
  const chartData = attendance
    .filter(a => a.status === 'completed' && a.checkOutTime)
    .reduce((acc: any[], curr) => {
      const checkIn = safeDate(curr.checkInTime);
      const checkOut = safeDate(curr.checkOutTime);
      if (!checkIn || !checkOut) return acc;

      try {
        const dateStr = format(checkIn, 'MMM d');
        const totalMinutes = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60);
        const netMinutes = totalMinutes - 60 - (curr.additionalBreakMinutes || 0);
        const hours = Math.max(0, netMinutes / 60);
        
        const existing = acc.find(i => i.date === dateStr);
        if (existing) existing.hours = parseFloat((existing.hours + hours).toFixed(1));
        else acc.push({ date: dateStr, hours: parseFloat(hours.toFixed(1)) });
      } catch (e) {
        console.error('Error processing chart data', e);
      }
      return acc;
    }, [])
    .slice(-7);

  const pieData = Object.entries(
    attendance
      .filter(a => a.status === 'completed')
      .reduce((acc: Record<string, number>, curr) => {
        const user = users.find(u => u.uid === curr.userId);
        const div = user?.division || 'Unassigned';
        const checkIn = curr.checkInTime ? new Date(curr.checkInTime) : null;
        const checkOut = curr.checkOutTime ? new Date(curr.checkOutTime) : null;
        if (checkIn && checkOut && !isNaN(checkIn.getTime()) && !isNaN(checkOut.getTime())) {
          const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 3600);
          acc[div] = (acc[div] || 0) + hours;
        }
        return acc;
      }, {})
  ).map(([name, value]: any) => ({ name, value: parseFloat(Number(value).toFixed(1)) }));

  const punctualityData = attendance
    .filter(a => a.checkInTime)
    .reduce((acc: any[], curr) => {
      const date = format(new Date(curr.checkInTime), 'MMM dd');
      const checkIn = new Date(curr.checkInTime);
      const limit = new Date(checkIn);
      limit.setHours(8, 5, 0);
      const isOnTime = checkIn <= limit;

      const existing = acc.find(a => a.date === date);
      if (existing) {
        existing.total++;
        if (isOnTime) existing.onTime++;
        existing.percent = Math.round((existing.onTime / existing.total) * 100);
      } else {
        acc.push({ date, total: 1, onTime: isOnTime ? 1 : 0, percent: isOnTime ? 100 : 0 });
      }
      return acc;
    }, []).slice(-7);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8 transition-colors duration-300">
      <div className="mx-auto max-w-6xl space-y-8">
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
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t('Admin')} Dashboard</h1>
              <p className="text-zinc-500 dark:text-zinc-400">{t('Monitor attendance and manage company operations.')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <div className="flex bg-zinc-200/50 dark:bg-zinc-800/50 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
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
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-4 lg:grid-cols-6">
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors"
            onClick={() => setActiveTab('attendance')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Active Employees</CardTitle>
              <Users className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold dark:text-white">{activeEmployees}</div>
            </CardContent>
          </Card>
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors"
            onClick={() => setActiveTab('leave')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Pending Leaves</CardTitle>
              <Calendar className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold dark:text-white">{pendingLeaves}</div>
            </CardContent>
          </Card>
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors"
            onClick={() => setActiveTab('corrections')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Manual Requests</CardTitle>
              <HelpCircle className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold dark:text-white">{manualRequests.filter(r => r.status === 'pending').length}</div>
            </CardContent>
          </Card>
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors"
            onClick={() => setActiveTab('locations')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Locations</CardTitle>
              <MapPin className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold dark:text-white">{locations.length}</div>
            </CardContent>
          </Card>
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-700 transition-colors"
            onClick={() => setActiveTab('users')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Users</CardTitle>
              <Users className="h-4 w-4 text-zinc-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold dark:text-white">{users.length}</div>
            </CardContent>
          </Card>
          <Card 
            className="border-zinc-200 dark:border-zinc-800 bg-orange-50/10 dark:bg-orange-950/20 shadow-sm cursor-pointer hover:border-orange-400 transition-colors"
            onClick={() => setActiveTab('audits')}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-orange-600 dark:text-orange-400">Audit Violations</CardTitle>
              <ShieldAlert className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-700 dark:text-orange-400">{locationAudits.length}</div>
            </CardContent>
          </Card>
        </div>

        <div ref={tabsContentRef}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-col sm:flex-row flex-wrap h-auto w-full justify-start gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-1.5 border border-zinc-200 dark:border-zinc-800">
            <TabsTrigger value="attendance" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Attendance History')}</TabsTrigger>
            <TabsTrigger value="map" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Operational Map')}</TabsTrigger>
            <TabsTrigger value="team-status" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Team Status')}</TabsTrigger>
            <TabsTrigger value="leave" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Leave Management')}</TabsTrigger>
            <TabsTrigger value="corrections" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Corrections')}</TabsTrigger>
            <TabsTrigger value="locations" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Locations')}</TabsTrigger>
            <TabsTrigger value="users" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('User Management')}</TabsTrigger>
            <TabsTrigger value="audits" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Audit Logs')}</TabsTrigger>
            <TabsTrigger value="analytics" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Analytics')}</TabsTrigger>
            <TabsTrigger value="settings" className="flex-grow sm:flex-grow-0 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100 whitespace-nowrap min-h-[40px] px-4">{t('Settings')}</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-6">
            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
              <CardHeader>
                <CardTitle>{t('Field Operations Map')}</CardTitle>
                <CardDescription>
                  {t('Real-time visualization of employees across all registered locations.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <MapSection locationStats={locationStats} t={t} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team-status" className="mt-6">
            <div className="grid gap-6 md:grid-cols-3 mb-6">
              <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-emerald-700 dark:text-emerald-400 text-sm font-medium uppercase tracking-wider">{t('Active')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-emerald-900 dark:text-emerald-100">{teamStats.active}</div>
                  <p className="text-sm text-emerald-600 dark:text-emerald-500 mt-1">{t('Working right now')}</p>
                </CardContent>
              </Card>
              <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-orange-700 dark:text-orange-400 text-sm font-medium uppercase tracking-wider">{t('On Day Off')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-orange-900 dark:text-orange-100">{teamStats.dayOff}</div>
                  <p className="text-sm text-orange-600 dark:text-orange-500 mt-1">{t('Approved leave today')}</p>
                </CardContent>
              </Card>
              <Card className="bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-zinc-500 dark:text-zinc-400 text-sm font-medium uppercase tracking-wider">{t('Inactive')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">{teamStats.inactive}</div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('Not checked in yet')}</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <CardHeader>
                <CardTitle className="dark:text-zinc-100">{t('Full Team Status')}</CardTitle>
                <CardDescription className="dark:text-zinc-400">{t('Detailed view of every employee status for today.')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-zinc-50 dark:bg-zinc-950">
                      <TableRow className="dark:border-zinc-800 dark:hover:bg-zinc-900/50">
                        <TableHead className="dark:text-zinc-400">{t('Name')}</TableHead>
                        <TableHead className="dark:text-zinc-400">{t('Division')}</TableHead>
                        <TableHead className="dark:text-zinc-400">{t('Status')}</TableHead>
                        <TableHead className="dark:text-zinc-400">{t('Current Location')}</TableHead>
                        <TableHead className="dark:text-zinc-400">{t('Latest Activity')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map(user => {
                        const activeRecord = activeRecordsToday.find(r => r.userId === user.uid);
                        const onDayOff = dayOffUserIds.has(user.uid);
                        
                        let status: 'active' | 'day-off' | 'inactive' = 'inactive';
                        if (activeRecord) status = 'active';
                        else if (onDayOff) status = 'day-off';

                        return (
                          <TableRow key={user.uid} className="dark:border-zinc-800 dark:hover:bg-zinc-900/50">
                            <TableCell className="font-medium dark:text-zinc-200">{user.displayName}</TableCell>
                            <TableCell className="text-zinc-500 dark:text-zinc-400 text-xs">{user.division || '-'}</TableCell>
                            <TableCell>
                              <Badge 
                                className={
                                  status === 'active' 
                                    ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 inline-flex items-center gap-1' 
                                    : status === 'day-off'
                                      ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800/50 inline-flex items-center gap-1'
                                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1'
                                }
                                variant="outline"
                              >
                                {status === 'active' ? (
                                  <><Clock className="h-3 w-3" /> {t('Working')}</>
                                ) : status === 'day-off' ? (
                                  <><Calendar className="h-3 w-3" /> {t('Day Off')}</>
                                ) : (
                                  <><XCircle className="h-3 w-3" /> {t('Inactive')}</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs dark:text-zinc-300">
                              {activeRecord ? activeRecord.locationName : '-'}
                            </TableCell>
                            <TableCell className="text-xs text-zinc-400 dark:text-zinc-500">
                              {activeRecord ? format(new Date(activeRecord.checkInTime), 'HH:mm') : '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attendance" className="mt-6">
            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="dark:text-zinc-100">{t('Attendance History')}</CardTitle>
                  <CardDescription className="dark:text-zinc-400">{t('View and manage employee check-in records.')}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                    <Button 
                      variant={attendanceView === 'daily' ? 'default' : 'ghost'} 
                      size="sm" 
                      className="h-8 rounded-md"
                      onClick={() => setAttendanceView('daily')}
                    >
                      Daily
                    </Button>
                    <Button 
                      variant={attendanceView === 'weekly' ? 'default' : 'ghost'} 
                      size="sm" 
                      className="h-8 rounded-md"
                      onClick={() => setAttendanceView('weekly')}
                    >
                      Weekly
                    </Button>
                  </div>
                  <Input 
                    type="date" 
                    className="h-9 w-40 dark:bg-zinc-950 dark:border-zinc-800" 
                    value={selectedDate} 
                    onChange={(e) => setSelectedDate(e.target.value)} 
                  />
                </div>
              </CardHeader>
              <CardContent>
                {Object.keys(groupedAttendance).length === 0 ? (
                  <div className="text-center py-12 text-zinc-500">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>No attendance records found for this period.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedAttendance).map(([division, roles]) => (
                      <div key={division} className="border border-zinc-200 rounded-lg overflow-hidden">
                        <button 
                          className="w-full flex items-center justify-between p-4 bg-zinc-50 hover:bg-zinc-100 transition-colors"
                          onClick={() => toggleDivision(division)}
                        >
                          <div className="flex items-center gap-3">
                            {expandedDivisions[division] ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                            <h3 className="font-bold text-zinc-900 dark:text-zinc-100">{division}</h3>
                            <Badge variant="secondary" className="bg-zinc-200 text-zinc-700">
                              {Object.values(roles).flat().length} Records
                            </Badge>
                          </div>
                        </button>
                        
                        {expandedDivisions[division] && (
                          <div className="p-4 space-y-6 bg-white dark:bg-zinc-900">
                            {Object.entries(roles).map(([role, records]) => (
                              <div key={role} className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-zinc-800 uppercase text-[10px] tracking-wider">{role}</Badge>
                                  <div className="h-[1px] flex-1 bg-zinc-100"></div>
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                      <TableHead className="w-[200px]">Employee</TableHead>
                                      <TableHead>Location</TableHead>
                                      <TableHead>Check In</TableHead>
                                      <TableHead>Check Out</TableHead>
                                      <TableHead>Total Hours</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead className="text-right">Verification</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {records.map(record => (
                                      <TableRow key={record.id}>
                                        <TableCell className="font-medium">{record.userName}</TableCell>
                                        <TableCell>{record.locationName}</TableCell>
                                        <TableCell>{format(new Date(record.checkInTime), 'MMM d, HH:mm')}</TableCell>
                                        <TableCell>{record.checkOutTime ? format(new Date(record.checkOutTime), 'MMM d, HH:mm') : '-'}</TableCell>
                                        <TableCell>
                                          <div className="text-xs">
                                            <p className="font-medium">{calculateTotalHours(record.checkInTime, record.checkOutTime, record.additionalBreakMinutes)}</p>
                                            {record.additionalBreakMinutes ? (
                                              <p className="text-[10px] text-zinc-400">Incl. {record.additionalBreakMinutes}m extra break</p>
                                            ) : record.checkOutTime ? (
                                              <p className="text-[10px] text-zinc-400">Incl. 1h standard break</p>
                                            ) : null}
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <Badge 
                                            className={
                                              record.status === 'active' 
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50' 
                                                : 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                                            }
                                            variant="outline"
                                          >
                                            {record.status}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <div className="flex justify-end gap-1">
                                            <Button 
                                              variant="ghost" 
                                              size="icon" 
                                              className="h-8 w-8 text-zinc-400 hover:text-zinc-600"
                                              onClick={() => {
                                                setEditingAttendance(record);
                                                setEditCheckIn(format(new Date(record.checkInTime), "yyyy-MM-dd'T'HH:mm"));
                                                setEditCheckOut(record.checkOutTime ? format(new Date(record.checkOutTime), "yyyy-MM-dd'T'HH:mm") : '');
                                                setEditBreak(String(record.additionalBreakMinutes || 0));
                                              }}
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </Button>
                                            {record.checkInPhoto && (
                                              <Dialog>
                                                <DialogTrigger render={
                                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <Clock className="h-4 w-4" />
                                                  </Button>
                                                } />
                                                <DialogContent>
                                                  <DialogHeader>
                                                    <DialogTitle>Check-in Verification</DialogTitle>
                                                    <DialogDescription>
                                                      Device: {record.checkInDevice || 'Unknown'}
                                                    </DialogDescription>
                                                  </DialogHeader>
                                                  <img src={record.checkInPhoto} alt="Check-in" className="w-full rounded-lg" />
                                                </DialogContent>
                                              </Dialog>
                                            )}
                                            {record.checkOutPhoto && (
                                              <Dialog>
                                                <DialogTrigger render={
                                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <LogOut className="h-4 w-4" />
                                                  </Button>
                                                } />
                                                <DialogContent>
                                                  <DialogHeader>
                                                    <DialogTitle>Check-out Verification</DialogTitle>
                                                    <DialogDescription>
                                                      Device: {record.checkOutDevice || 'Unknown'}
                                                    </DialogDescription>
                                                  </DialogHeader>
                                                  <img src={record.checkOutPhoto} alt="Check-out" className="w-full rounded-lg" />
                                                </DialogContent>
                                              </Dialog>
                                            )}
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leave" className="mt-6">
            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
            <CardHeader>
                <CardTitle className="dark:text-zinc-100">{t('Leave Requests')}</CardTitle>
                <CardDescription className="dark:text-zinc-400">{t('Review and approve employee time-off requests.')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveRequests.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.userName}</TableCell>
                        <TableCell>{req.startDate} to {req.endDate}</TableCell>
                        <TableCell>{req.reason}</TableCell>
                        <TableCell>
                          <Badge 
                            className={
                              req.status === 'approved' 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50' 
                                : req.status === 'denied'
                                ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50'
                                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50'
                            }
                            variant="outline"
                          >
                            {req.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {req.status === 'pending' && (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => handleApproveLeave(req.id)} className="h-8">
                                <CheckCircle2 className="mr-1 h-4 w-4 text-green-600" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleDenyLeave(req.id)} className="h-8">
                                <XCircle className="mr-1 h-4 w-4 text-red-600" /> Deny
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="corrections" className="mt-6">
            <Dialog open={!!adjustingRequest} onOpenChange={(open) => !open && setAdjustingRequest(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('Adjust Manual Hours')}</DialogTitle>
                  <DialogDescription>
                    {t('You can modify the requested hours before approving.')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('Hours to record')}</Label>
                    <Input 
                      type="number" 
                      step="0.5" 
                      value={adjustedHours} 
                      onChange={e => setAdjustedHours(e.target.value)} 
                    />
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
                    <p><strong>{t('Employee')}:</strong> {adjustingRequest?.userName}</p>
                    <p><strong>{t('Reason')}:</strong> {adjustingRequest?.reason}</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAdjustingRequest(null)}>{t('Cancel')}</Button>
                  <Button 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      if (adjustingRequest) {
                        handleManualRequest(adjustingRequest, 'approved', parseFloat(adjustedHours));
                        setAdjustingRequest(null);
                      }
                    }}
                  >
                    <Check className="h-4 w-4 mr-2" /> {t('Approve & Set Hours')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <CardHeader>
                <CardTitle className="dark:text-zinc-100">{t('Manual Attendance Corrections')}</CardTitle>
                <CardDescription className="dark:text-zinc-400">{t('Requests for manual check-ins/outs due to errors or missing geofence triggers')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Employee')}</TableHead>
                      <TableHead>{t('Type')}</TableHead>
                      <TableHead>{t('Requested Time')}</TableHead>
                      <TableHead>{t('Reason')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                      <TableHead className="text-right">{t('Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualRequests.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell>
                          <div className="font-medium">{req.userName}</div>
                          <div className="text-[10px] text-zinc-400">{req.locationName}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            req.type === 'check-in' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 
                            req.type === 'full-shift' ? 'border-blue-200 text-blue-700 bg-blue-50' : 
                            'border-amber-200 text-amber-700 bg-amber-50'
                          }>
                            {req.type === 'full-shift' ? t('Manual Entry (In & Out)') : t(req.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {format(new Date(req.requestedTime), 'MMM dd, HH:mm')}
                            {req.type === 'full-shift' && req.requestedOutTime && (
                              <> - {format(new Date(req.requestedOutTime), 'HH:mm')}</>
                            )}
                          </div>
                          {req.type === 'additional-hours' && (
                            <div className="text-xs font-bold text-amber-600">
                              {req.hours} {t('Hours')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm max-w-[200px] truncate" title={req.reason}>
                            {req.reason}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            className={
                              req.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              req.status === 'denied' ? 'bg-red-50 text-red-700 border-red-100' :
                              'bg-amber-50 text-amber-700 border-amber-100'
                            }
                            variant="outline"
                          >
                            {t(req.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {req.status === 'pending' && (
                            <div className="flex justify-end gap-2">
                              {req.type === 'additional-hours' ? (
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="h-8 border-amber-200 text-amber-600 hover:bg-amber-50" 
                                  onClick={() => {
                                    setAdjustingRequest(req);
                                    setAdjustedHours(req.hours?.toString() || '');
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-1" /> {t('Adjust')}
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-600 hover:bg-emerald-50" onClick={() => handleManualRequest(req, 'approved')}>
                                  <Check className="h-4 w-4 mr-1" /> {t('Approve')}
                                </Button>
                              )}
                              <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-600 hover:bg-red-50" onClick={() => handleManualRequest(req, 'denied')}>
                                <XCircle className="h-4 w-4 mr-1" /> {t('Deny')}
                              </Button>
                            </div>
                          )}
                          {req.status !== 'pending' && (
                            <div className="text-[10px] text-zinc-400">
                              <div>{t('By')} {req.processedBy}</div>
                              <div>{req.processedAt && format(new Date(req.processedAt), 'MMM dd')}</div>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {manualRequests.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center text-zinc-500">
                          {t('No manual requests found')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations" className="mt-6 space-y-6">
            <Card className="border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="dark:text-zinc-100">{t('Work Locations')}</CardTitle>
                  <CardDescription className="dark:text-zinc-400">{t('Manage geofenced areas for employee check-ins.')}</CardDescription>
                </div>
                <Dialog>
                  <DialogTrigger render={
                    <Button className="bg-zinc-900">
                      <Plus className="mr-2 h-4 w-4" /> {t('Add Location')}
                    </Button>
                  } />
                  <DialogContent className="dark:bg-zinc-900 dark:border-zinc-800">
                    <DialogHeader>
                      <DialogTitle>{t('Add New Location')}</DialogTitle>
                      <DialogDescription>{t('Search for an address or set coordinates manually.')}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="space-y-2 relative">
                        <Label>{t('Search Address')}</Label>
                        <div className="relative">
                          <Input 
                            placeholder={t('Search for a place...')} 
                            value={searchQuery} 
                            onChange={e => handleSearchAddress(e.target.value)}
                          />
                          {isSearching && (
                            <div className="absolute right-3 top-3">
                              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                            </div>
                          )}
                        </div>
                        {searchResults.length > 0 && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-60 overflow-auto dark:bg-zinc-950 dark:border-zinc-800">
                            {searchResults.map((result, idx) => (
                              <button
                                key={idx}
                                className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 border-b border-zinc-50 last:border-0 dark:hover:bg-zinc-900 dark:border-zinc-800"
                                onClick={() => selectSearchResult(result)}
                              >
                                <p className="font-medium truncate">{result.display_name.split(',')[0]}</p>
                                <p className="text-xs text-zinc-500 truncate">{result.display_name}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>{t('Name')}</Label>
                        <Input placeholder={t('Main Office')} value={newLocName} onChange={e => setNewLocName(e.target.value)} required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('Latitude')}</Label>
                          <Input type="number" step="any" value={newLocLat} onChange={e => setNewLocLat(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('Longitude')}</Label>
                          <Input type="number" step="any" value={newLocLng} onChange={e => setNewLocLng(e.target.value)} required />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>{t('Radius (meters)')}</Label>
                        <Input type="number" value={newLocRadius} onChange={e => setNewLocRadius(e.target.value)} required />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleAddLocation} className="w-full bg-zinc-900">{t('Save Location')}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  {locations.map(loc => (
                    <Card key={loc.id} className="relative border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex justify-between items-start pr-8">
                          {loc.name}
                        </CardTitle>
                        <CardDescription>{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-zinc-500">{t('Radius')}: {loc.radius}m</p>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="absolute right-2 top-2 text-zinc-400 hover:text-red-600"
                          onClick={() => setLocationToDelete(loc.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="mt-6 space-y-6">
            <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
              <DialogContent className="sm:max-w-md dark:bg-zinc-900 dark:border-zinc-800">
                <DialogHeader>
                  <DialogTitle>{t('Invitation Created')}</DialogTitle>
                  <DialogDescription>
                    {t('The invitation link has been generated and copied to your clipboard.')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="rounded-lg bg-zinc-50 p-3 border border-zinc-200">
                    <p className="text-xs font-mono break-all text-zinc-600">{generatedInviteLink}</p>
                  </div>
                  {generatedInviteLink.includes('aistudio.google.com') && (
                    <div className="rounded-lg bg-amber-50 p-3 border border-amber-200 flex gap-3">
                      <XCircle className="h-5 w-5 text-amber-600 shrink-0" />
                      <div className="text-xs text-amber-800">
                        <p className="font-bold mb-1">{t('Warning: Incorrect Link Origin')}</p>
                        <p>{t('The link points to "aistudio.google.com". This will NOT work for the employee.')}</p>
                        <p className="mt-2">{t('Please use the Shared App URL (found in the Share menu) and add ?token=... to it manually if needed, or open the app via the Shared URL before inviting.')}</p>
                      </div>
                    </div>
                  )}
                  <Button 
                    className="w-full" 
                    onClick={() => {
                      navigator.clipboard.writeText(generatedInviteLink);
                      toast.success(t('Link copied again'));
                    }}
                  >
                    {t('Copy Link Again')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Card className="border-zinc-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{t('Invite New Member')}</CardTitle>
                  <CardDescription>{t('Send an invitation link to a new employee.')}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-end">
                  <div className="space-y-2">
                    <Label>{t('Full Name')}</Label>
                    <Input 
                      placeholder="John Doe" 
                      value={inviteName} 
                      onChange={e => setInviteName(e.target.value)} 
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('Email Address')}</Label>
                    <Input 
                      placeholder="employee@company.com" 
                      value={inviteEmail} 
                      onChange={e => setInviteEmail(e.target.value)} 
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('Division')}</Label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:bg-zinc-950 dark:border-zinc-800"
                      value={inviteDivision}
                      onChange={e => setInviteDivision(e.target.value)}
                    >
                      <option value="Compliance Division">{t('Compliance Division')}</option>
                      <option value="Telecoms Division">{t('Telecoms Division')}</option>
                      <option value="Logistics Division">{t('Logistics Division')}</option>
                      <option value="Electrical Division">{t('Electrical Division')}</option>
                      <option value="GRV Department">{t('GRV Department')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('Role')}</Label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:bg-zinc-950 dark:border-zinc-800"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as any)}
                    >
                      <option value="admin">{t('Admin')}</option>
                      <option value="manager">{t('Manager')}</option>
                      <option value="supervisor">{t('Supervisor')}</option>
                      <option value="technician">{t('Technician')}</option>
                      <option value="employee">{t('Employee')}</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 lg:col-span-4 flex justify-end gap-3">
                    <Button onClick={handleInviteUser} variant="outline" className="w-full md:w-auto">
                      <Plus className="mr-2 h-4 w-4" /> {t('Invite User (Link)')}
                    </Button>
                    <Button onClick={handleCreateUser} className="bg-zinc-900 w-full md:w-auto">
                      <Users className="mr-2 h-4 w-4" /> {t('Create User Directly')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {invitations.filter(i => i.status === 'pending').length > 0 && (
              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle>{t('Pending Invitations')}</CardTitle>
                  <CardDescription>{t('Active links that haven\'t been used yet.')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Email')}</TableHead>
                        <TableHead>{t('Role')}</TableHead>
                        <TableHead>{t('Created')}</TableHead>
                        <TableHead className="text-right">{t('Actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.filter(i => i.status === 'pending').map(inv => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.email}</TableCell>
                          <TableCell className="capitalize">{t(inv.role)}</TableCell>
                          <TableCell>{format(new Date(inv.createdAt), 'MMM d')}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => {
                                  let origin = window.location.origin;
                                  if (origin.includes('ais-dev-')) {
                                    origin = origin.replace('ais-dev-', 'ais-pre-');
                                  }
                                  const link = `${origin}/?token=${inv.token}`;
                                  navigator.clipboard.writeText(link);
                                  toast.success(t('Link copied!'));
                                  toast.info(t('Remember to click Share so the link is public.'));
                                }}
                              >
                                {t('Copy Link')}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setInviteToDelete(inv.id)}>
                                <Trash2 className="h-4 w-4 text-zinc-400 hover:text-red-600" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card className="border-zinc-200 shadow-sm">
              <CardHeader>
                <CardTitle>{t('Active Users')}</CardTitle>
                <CardDescription>{t('Manage employee roles and permissions.')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Name')}</TableHead>
                      <TableHead>{t('Email')}</TableHead>
                      <TableHead>{t('Division')}</TableHead>
                      <TableHead>{t('Role')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                      <TableHead className="text-right">{t('Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.uid}>
                        <TableCell className="font-medium">{u.displayName}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>{u.division || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === 'admin' ? 'default' : 'outline'}>
                            {u.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            className={
                              u.status === 'invited' 
                                ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50' 
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                            }
                            variant="outline"
                          >
                            {u.status || 'active'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {u.uid !== profile.uid && (
                            <div className="flex justify-end gap-2">
                              <select 
                                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
                                value={u.role}
                                onChange={async (e) => {
                                  const newRole = e.target.value as UserProfile['role'];
                                  await updateDoc(doc(db, 'users', u.uid), { role: newRole });
                                  toast.success(`Role updated for ${u.displayName}`);
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="manager">Manager</option>
                                <option value="supervisor">Supervisor</option>
                                <option value="technician">Technician</option>
                                <option value="employee">Employee</option>
                              </select>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0"
                                onClick={() => handleViewUserHistory(u)}
                                title={t('View History')}
                              >
                                <History className="h-4 w-4 text-zinc-500" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0"
                                onClick={() => {
                                  setEditingReminders(u);
                                  setRemCheckIn(u.reminders?.checkIn ? [...u.reminders.checkIn, '', '', ''].slice(0, 3) : ['', '', '']);
                                  setRemCheckOut(u.reminders?.checkOut ? [...u.reminders.checkOut, '', '', ''].slice(0, 3) : ['', '', '']);
                                }}
                                title="Set Reminders"
                              >
                                <Bell className="h-4 w-4 text-zinc-500" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600"
                                onClick={() => setUserToDelete({id: u.uid, name: u.displayName})}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Reminders Dialog */}
            <Dialog open={!!editingReminders} onOpenChange={(open) => !open && setEditingReminders(null)}>
              <DialogContent className="sm:max-w-[425px] dark:bg-zinc-900 dark:border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Set Reminders</DialogTitle>
                  <DialogDescription>
                    Configure check-in and check-out reminders for {editingReminders?.displayName}.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-500" /> Check-in Reminders
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {[0, 1, 2].map(i => (
                        <div key={`ci-wrap-${i}`} className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400 w-4">{i + 1}.</span>
                          <Input 
                            type="time" 
                            value={remCheckIn[i] || ''} 
                            onChange={e => {
                              const updated = [...remCheckIn];
                              updated[i] = e.target.value;
                              setRemCheckIn(updated);
                            }}
                            className="flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-orange-500" /> Check-out Reminders
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {[0, 1, 2].map(i => (
                        <div key={`co-wrap-${i}`} className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400 w-4">{i + 1}.</span>
                          <Input 
                            type="time" 
                            value={remCheckOut[i] || ''} 
                            onChange={e => {
                              const updated = [...remCheckOut];
                              updated[i] = e.target.value;
                              setRemCheckOut(updated);
                            }}
                            className="flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setEditingReminders(null)} variant="outline">Cancel</Button>
                  <Button onClick={handleUpdateReminders} className="bg-zinc-900">Save Reminders</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="audits" className="mt-6">
            <Card className="border-zinc-200 shadow-sm border-orange-100 bg-orange-50/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-orange-600" />
                  Location Audit Logs
                </CardTitle>
                <CardDescription>
                  Automatically recorded locations for users outside the geofence at 08:00 or 17:00 (Mon-Fri).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Distance</TableHead>
                      <TableHead>Nearest Location</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locationAudits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-zinc-500 italic">
                          No audit violations recorded.
                        </TableCell>
                      </TableRow>
                    ) : (
                      locationAudits.map(audit => (
                        <TableRow key={audit.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{audit.userName}</span>
                              <span className="text-xs text-zinc-500">{audit.email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={audit.type.includes('in') ? 'border-blue-200 text-blue-700 bg-blue-50' : 'border-orange-200 text-orange-700 bg-orange-50'}>
                              {audit.type === 'check-in-missed' ? 'Missed In (08:00)' : 'Missed Out (17:00)'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(audit.time), 'MMM d, HH:mm')}
                          </TableCell>
                          <TableCell>
                            <span className="text-red-600 font-medium">{audit.distanceFromGeofence}m</span>
                          </TableCell>
                          <TableCell className="text-zinc-600 italic">
                            {audit.nearestLocationName}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => window.open(`https://www.google.com/maps?q=${audit.location.lat},${audit.location.lng}`)}
                              >
                                <MapPin className="h-4 w-4 mr-1 text-zinc-400" /> {t('Map')}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                onClick={() => setAuditToDelete(audit.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="mt-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle>{t('Work Hours Trend')}</CardTitle>
                  <CardDescription>{t('Total hours worked per day across all employees.')}</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid var(--chart-tooltip-border)', 
                          backgroundColor: 'var(--chart-tooltip-bg)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
                        }}
                        itemStyle={{ color: 'var(--chart-text)' }}
                        cursor={{ fill: 'var(--chart-grid)' }}
                      />
                      <Bar dataKey="hours" fill="var(--chart-bar)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle>{t('Hours by Division')}</CardTitle>
                  <CardDescription>{t('Distribution of work hours between different departments.')}</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {[
                          'var(--chart-pie-1)', 'var(--chart-pie-2)', 'var(--chart-pie-3)', 'var(--chart-pie-4)', 'var(--chart-pie-5)'
                        ].map((color, index) => (
                          <Cell key={`cell-${index}`} fill={color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid var(--chart-tooltip-border)', 
                          backgroundColor: 'var(--chart-tooltip-bg)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
                        }}
                        itemStyle={{ color: 'var(--chart-text)' }}
                      />
                      <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: 'var(--chart-text)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle>{t('Punctuality Index')}</CardTitle>
                  <CardDescription>{t('Percentage of check-ins before 08:05 AM.')}</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                   <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={punctualityData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid var(--chart-tooltip-border)', 
                          backgroundColor: 'var(--chart-tooltip-bg)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
                        }}
                        itemStyle={{ color: 'var(--chart-text)' }}
                      />
                      <Line type="monotone" dataKey="percent" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle>{t('Location Usage')}</CardTitle>
                  <CardDescription>{t('Volume of check-ins per work location.')}</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={locations.map(loc => ({
                      name: loc.name,
                      count: attendance.filter(a => a.locationId === loc.id).length
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: '1px solid var(--chart-tooltip-border)', 
                          backgroundColor: 'var(--chart-tooltip-bg)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
                        }}
                        itemStyle={{ color: 'var(--chart-text)' }}
                        cursor={{ fill: 'var(--chart-grid)' }}
                      />
                      <Bar dataKey="count" fill="var(--chart-bar)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="settings" className="mt-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-zinc-900 dark:text-zinc-100" />
                    {t('Announcements')}
                  </CardTitle>
                  <CardDescription>
                    {t('New Announcement')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('Message')}</Label>
                    <textarea 
                      className="w-full min-h-[100px] p-3 rounded-md border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:border-zinc-800"
                      placeholder={t('Type message here...')}
                      value={newAnnouncement}
                      onChange={(e) => setNewAnnouncement(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleCreateAnnouncement} 
                    disabled={isPostingAnnouncement || !newAnnouncement.trim()}
                    className="w-full"
                  >
                    {isPostingAnnouncement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    {t('Post Message')}
                  </Button>

                  <div className="pt-4 space-y-3">
                    {announcements.map((ann) => (
                      <div key={ann.id} className="flex items-start justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100 dark:bg-zinc-900 dark:border-zinc-800">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{ann.message}</p>
                          <p className="text-xs text-zinc-500">{format(new Date(ann.createdAt), 'MMM d, HH:mm')}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleDeleteAnnouncement(ann.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        </div>

        {/* Download Section at the Bottom */}
        <div className="flex flex-col sm:flex-row justify-center gap-4 pt-8 border-t border-zinc-200 dark:border-zinc-800">
          <Button 
            variant="outline" 
            className="dark:border-zinc-800 dark:hover:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 h-10 px-6 rounded-xl font-bold transition-all" 
            onClick={handleDownloadExcel}
          >
            <Download className="mr-2 h-4 w-4" />
            {t('Export Attendance Report (Excel)')}
          </Button>
          <Button 
            variant="outline" 
            className="dark:border-zinc-800 dark:hover:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 h-10 px-6 rounded-xl font-bold transition-all" 
            onClick={handleDownloadLeaveReport}
          >
            <Calendar className="mr-2 h-4 w-4" />
            {t('Export Leave Management Report (Excel)')}
          </Button>
        </div>
      </div>

      {/* Delete User Confirmation */}
      <Dialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Delete User
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{userToDelete?.name}</strong>? 
              This will remove their profile from the system. Attendance records will remain but will be orphaned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setUserToDelete(null)} className="flex-1">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => userToDelete && handleDeleteUser(userToDelete.id, userToDelete.name)}
              className="flex-1"
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Invitation Confirmation */}
      <Dialog open={!!inviteToDelete} onOpenChange={() => setInviteToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Revoke Invitation
            </DialogTitle>
            <DialogDescription>
              This will deactivate the invitation link. The user will no longer be able to register using this token.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setInviteToDelete(null)} className="flex-1">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => inviteToDelete && handleDeleteInvite(inviteToDelete)}
              className="flex-1"
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Audit Log Confirmation */}
      <Dialog open={!!auditToDelete} onOpenChange={() => setAuditToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> {t('Delete Audit Log')}
            </DialogTitle>
            <DialogDescription>
              {t('Are you sure you want to delete this audit log? This action cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setAuditToDelete(null)} className="flex-1">
              {t('Cancel')}
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteAudit}
              className="flex-1"
            >
              {t('Confirm Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Confirmation */}
      <Dialog open={!!locationToDelete} onOpenChange={() => setLocationToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> {t('Delete Location')}
            </DialogTitle>
            <DialogDescription>
              {t('Are you sure you want to delete this location? This action cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setLocationToDelete(null)} className="flex-1">
              {t('Cancel')}
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteLocation}
              className="flex-1"
            >
              {t('Confirm Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Location Name Dialog */}
      <Dialog open={!!editingLocation} onOpenChange={() => setEditingLocation(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Location Name</DialogTitle>
            <DialogDescription>
              Update the display name for this work location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Location Name</Label>
              <Input 
                value={editLocName}
                onChange={(e) => setEditLocName(e.target.value)}
                placeholder="Workplace Name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUpdateLocationName();
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditingLocation(null)} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateLocationName}
              className="flex-1 bg-zinc-900"
              disabled={!editLocName.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Attendance Record Dialog */}
      <Dialog open={!!editingAttendance} onOpenChange={() => setEditingAttendance(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Attendance Record</DialogTitle>
            <DialogDescription>
              Manually adjust check-in, check-out times or break duration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Check In Time</Label>
              <Input 
                type="datetime-local" 
                value={editCheckIn} 
                onChange={e => setEditCheckIn(e.target.value)} 
              />
            </div>
            <div className="space-y-2">
              <Label>Check Out Time</Label>
              <Input 
                type="datetime-local" 
                value={editCheckOut} 
                onChange={e => setEditCheckOut(e.target.value)} 
                placeholder="Not checked out yet"
              />
              <p className="text-[10px] text-zinc-500">Leaving this empty will keep the record 'active'.</p>
            </div>
            <div className="space-y-2">
              <Label>Additional Break (minutes)</Label>
              <Input 
                type="number" 
                value={editBreak} 
                onChange={e => setEditBreak(e.target.value)} 
              />
              <p className="text-[10px] text-zinc-500">Manual break time on top of standard 1h.</p>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditingAttendance(null)} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateRecord}
              className="flex-1 bg-zinc-900"
            >
              Update Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User History Dialog */}
      <Dialog open={!!selectedUserHistory} onOpenChange={(open) => !open && setSelectedUserHistory(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col dark:bg-zinc-900 dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-zinc-900 dark:text-zinc-100" />
              {t('Full Attendance History')} - {selectedUserHistory?.displayName}
            </DialogTitle>
            <DialogDescription>
              {t('A complete list of check-in and check-out logs with location details.')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto py-4 pr-1">
            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
                <Loader2 className="h-8 w-8 animate-spin mb-2" />
                <p className="text-sm">{t('Loading records...')}</p>
              </div>
            ) : userHistoryRecords.length === 0 ? (
              <div className="text-center py-20 text-zinc-500 italic">
                {t('No attendance records found for this user.')}
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-zinc-50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead>{t('Date')}</TableHead>
                    <TableHead>{t('Location')}</TableHead>
                    <TableHead>{t('Time In')}</TableHead>
                    <TableHead>{t('Time Out')}</TableHead>
                    <TableHead>{t('Net Hours')}</TableHead>
                    <TableHead className="text-right">{t('Verification')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userHistoryRecords.map(record => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        {format(new Date(record.checkInTime), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col">
                          <span>{record.locationName}</span>
                          {record.checkInLocation && (
                             <button 
                               onClick={() => window.open(`https://www.google.com/maps?q=${record.checkInLocation?.lat},${record.checkInLocation?.lng}`)}
                               className="text-[10px] text-blue-500 hover:underline text-left inline-flex items-center gap-1 mt-0.5"
                             >
                               <MapPin className="h-3 w-3" /> {t('Show on Map')}
                             </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{format(new Date(record.checkInTime), 'HH:mm')}</TableCell>
                      <TableCell className="text-xs">
                        {record.checkOutTime ? format(new Date(record.checkOutTime), 'HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {calculateTotalHours(record.checkInTime, record.checkOutTime, record.additionalBreakMinutes)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {record.checkInPhoto && (
                            <Dialog>
                              <DialogTrigger render={
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 p-0" 
                                  title={t('Check-in Photo')}
                                >
                                  <Clock className="h-4 w-4 text-emerald-500" />
                                </Button>
                              } />
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>{t('Check-in Verification')}</DialogTitle>
                                </DialogHeader>
                                <img src={record.checkInPhoto} alt="In" className="w-full rounded-lg" />
                              </DialogContent>
                            </Dialog>
                          )}
                          {record.checkOutPhoto && (
                            <Dialog>
                              <DialogTrigger render={
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 p-0" 
                                  title={t('Check-out Photo')}
                                >
                                  <LogOut className="h-4 w-4 text-orange-500" />
                                </Button>
                              } />
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>{t('Check-out Verification')}</DialogTitle>
                                </DialogHeader>
                                <img src={record.checkOutPhoto} alt="Out" className="w-full rounded-lg" />
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          
          <DialogFooter className="mt-4 pt-4 border-t">
            <Button onClick={() => setSelectedUserHistory(null)} className="w-full sm:w-auto bg-zinc-900">
              {t('Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
