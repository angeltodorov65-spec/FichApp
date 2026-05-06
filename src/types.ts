export type UserRole = 'employee' | 'admin' | 'manager' | 'supervisor' | 'technician';

export type Division = 
  | 'Compliance Division' 
  | 'Telecoms Division' 
  | 'Logistics Division' 
  | 'Electrical Division' 
  | 'GRV Department';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  division?: Division;
  photoURL?: string;
  createdAt: string;
  status?: 'active' | 'invited';
  reminders?: {
    checkIn: string[];
    checkOut: string[];
  };
  dayOffDate?: string; // ISO date string (YYYY-MM-DD)
  position?: string; // Added for position-based logic
}

export interface ManualAttendanceRequest {
  id: string;
  userId: string;
  userName: string;
  type: 'check-in' | 'check-out' | 'additional-hours' | 'full-shift';
  requestedTime: string; // ISO string for the exact time
  requestedOutTime?: string; // ISO string for check-out time (full-shift)
  hours?: number; // Added for additional-hours type
  reason: string; // Reason for missing geo-zone or check
  locationId: string;
  locationName: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  processedBy?: string;
  processedAt?: string;
  attendanceId?: string; // Link to attendance record if it's a check-out
}

export interface LocationAudit {
  id: string;
  userId: string;
  userName: string;
  email: string;
  time: string;
  type: 'check-in-missed' | 'check-out-missed';
  location: { lat: number; lng: number };
  distanceFromGeofence: number;
  nearestLocationName?: string;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius: number; // in meters
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  locationId: string;
  locationName: string;
  checkInTime: string;
  checkOutTime?: string;
  checkInPhoto?: string;
  checkOutPhoto?: string;
  checkInLocation: { lat: number; lng: number };
  checkOutLocation?: { lat: number; lng: number };
  checkInDevice?: string;
  checkOutDevice?: string;
  additionalBreakMinutes?: number;
  status: 'active' | 'completed';
  isManual?: boolean;
  manualReason?: string;
  approvedBy?: string;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  reviewedBy?: string;
  reviewComment?: string;
}
