import { differenceInMinutes, parseISO, isValid } from 'date-fns';

const safeDate = (dateInput: any): Date | null => {
  if (!dateInput) return null;
  if (typeof dateInput.toDate === 'function') return dateInput.toDate();
  if (dateInput instanceof Date) return dateInput;
  const parsed = typeof dateInput === 'string' ? parseISO(dateInput) : new Date(dateInput);
  return isValid(parsed) ? parsed : null;
};

export function calculateTotalHoursNumeric(checkIn: any, checkOut?: any, additionalBreakMinutes: number = 0): number {
  if (!checkOut || !checkIn) return 0;
  
  try {
    const start = safeDate(checkIn);
    const end = safeDate(checkOut);
    
    if (!start || !end) return 0;
    
    const totalMinutes = differenceInMinutes(end, start);
    const netMinutes = totalMinutes - 60 - (additionalBreakMinutes || 0);
    
    if (netMinutes <= 0) return 0;
    
    return parseFloat((netMinutes / 60).toFixed(2));
  } catch {
    return 0;
  }
}

export function calculateTotalHours(checkIn: any, checkOut?: any, additionalBreakMinutes: number = 0): string {
  if (!checkOut || !checkIn) return '--:--';
  
  try {
    const start = safeDate(checkIn);
    const end = safeDate(checkOut);
    
    if (!start || !end) return '--:--';
    
    // Total minutes between check-in and check-out
    const totalMinutes = differenceInMinutes(end, start);
    
    // Subtract 1 hour (60 mins) for standard break + additional break minutes
    const netMinutes = totalMinutes - 60 - (additionalBreakMinutes || 0);
    
    if (netMinutes <= 0) return '0h 0m';
    
    const hours = Math.floor(netMinutes / 60);
    const mins = netMinutes % 60;
    
    return `${hours}h ${mins}m`;
  } catch {
    return '--:--';
  }
}
