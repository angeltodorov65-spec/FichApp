import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { auth, db, googleProvider } from '../firebase';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogIn, Loader2, Mail, Lock, User as UserIcon } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { COMPANY_LOGO_URL, APP_NAME } from '../constants';
import { LanguageSwitcher } from './LanguageSwitcher';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthProvider as AuthWrapper };
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Login/Register state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);

  useEffect(() => {
    // Load remembered email
    const savedEmail = localStorage.getItem('remembered_email');
    if (savedEmail) {
      setEmail(savedEmail);
    }

    // Check for invitation token in URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      checkInvitation(token);
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        setUser(firebaseUser);
        if (firebaseUser) {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          const isAdminEmail = firebaseUser.email?.toLowerCase() === 'angel.todorov.65@gmail.com';
          
          if (userDoc.exists()) {
            const existingProfile = userDoc.data() as UserProfile;
            if (isAdminEmail && existingProfile.role !== 'admin') {
              const updatedProfile = { ...existingProfile, role: 'admin' as const };
              await setDoc(doc(db, 'users', firebaseUser.uid), updatedProfile);
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
          } else {
            const q = query(collection(db, 'users'), where('email', '==', firebaseUser.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const preProfile = querySnapshot.docs[0].data() as UserProfile;
              const oldId = querySnapshot.docs[0].id;
              
              const newProfile: UserProfile = { 
                ...preProfile, 
                uid: firebaseUser.uid,
                status: 'active' as const,
                displayName: firebaseUser.displayName || preProfile.displayName || 'User',
                photoURL: firebaseUser.photoURL || undefined
              };
              
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              if (oldId !== firebaseUser.uid) {
                await deleteDoc(doc(db, 'users', oldId));
              }
              setProfile(newProfile);
            } else if (isAdminEmail) {
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || 'Admin',
                role: 'admin',
                photoURL: firebaseUser.photoURL || undefined,
                createdAt: new Date().toISOString(),
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              setProfile(newProfile);
            }
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error('Profile fetch failed', err);
        toast.error(t('Failed to load profile. Please try again.'));
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [t]);

  const checkInvitation = async (token: string) => {
    const q = query(collection(db, 'invitations'), where('token', '==', token), where('status', '==', 'pending'));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const data = snapshot.docs[0].data();
      const inv = { id: snapshot.docs[0].id, ...data } as any;
      setInvitation(inv);
      setEmail(inv.email);
      setDisplayName(inv.invitedName);
      setIsRegistering(true);
      toast.info(t('Invitation verified! Please set your password.'));
    } else {
      toast.error(t('Invalid or expired invitation link.'));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
      toast.error(t('Google login failed'));
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        
        const role = invitation ? invitation.role : 'employee';
        const division = invitation ? invitation.division : undefined;
        
        const newProfile: UserProfile = {
          uid: userCredential.user.uid,
          email: email,
          displayName: displayName || 'User',
          role: role,
          division: division,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        
        await setDoc(doc(db, 'users', userCredential.user.uid), newProfile);
        
        if (invitation) {
          await updateDoc(doc(db, 'invitations', invitation.id), { status: 'accepted' });
          const params = new URLSearchParams(window.location.search);
          const currentToken = params.get('token');
          try {
            await deleteDoc(doc(db, 'users', `invited_${currentToken}`));
          } catch (e) {
            console.error('Failed to delete temporary invited user', e);
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        
        setProfile(newProfile);
        toast.success(t('Account created successfully!'));
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        if (rememberMe) {
          localStorage.setItem('remembered_email', email);
        } else {
          localStorage.removeItem('remembered_email');
        }
        toast.success(t('Logged in successfully!'));
      }
    } catch (error: any) {
      console.error('Auth failed', error);
      if (error.code === 'auth/email-already-in-use') {
        toast.error(t('This email is already registered. Please sign in instead.'));
        setIsRegistering(false);
      } else if (error.code === 'auth/invalid-credential') {
        toast.error(t('Invalid Credentials'));
      } else {
        toast.error(error.message || t('Error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.error(t('Enter email and name'));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(t('Success'));
    } catch (error: any) {
      toast.error(error.message || t('Error'));
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      <Toaster position="top-center" richColors />
      {loading ? (
        <div className="flex h-screen items-center justify-center bg-zinc-50">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-500 animate-pulse">{t('Loading...')}</p>
          </div>
        </div>
      ) : !user ? (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
          <div className="absolute right-4 top-4 z-50">
            <LanguageSwitcher />
          </div>
          <Card className="w-full max-w-md border-zinc-200 shadow-xl overflow-hidden relative">
            <div className="h-2 bg-zinc-900" />
            <CardHeader className="space-y-1 text-center pb-8">
              <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-white border border-zinc-100 shadow-sm p-3">
                {!imageError ? (
                  <img 
                    src={COMPANY_LOGO_URL} 
                    alt={APP_NAME} 
                    className="max-h-full max-w-full object-contain"
                    referrerPolicy="no-referrer"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <div className="text-zinc-400 font-bold text-lg text-center leading-tight">
                    {APP_NAME}
                  </div>
                )}
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {isRegistering ? (invitation ? `${t('Welcome')}, ${invitation.invitedName}` : t('Register')) : `${APP_NAME} ${t('Login')}`}
              </CardTitle>
              <CardDescription>
                {isRegistering 
                  ? (invitation 
                      ? `${t('Welcome')}, ${invitation.division}. ${t('Complete your registration to join the team.')}` 
                      : t('Complete your registration to join the team.'))
                  : t('Sign in to manage your work attendance.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleEmailAuth} className="space-y-4">
                {isRegistering && (
                  <div className="space-y-2">
                    <Label htmlFor="name">{t('Full Name')}</Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
                      <Input 
                        id="name" 
                        placeholder="John Doe" 
                        className="pl-10" 
                        value={displayName} 
                        onChange={e => setDisplayName(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">{t('Email Address')}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="name@company.com" 
                      className="pl-10" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      required
                      disabled={!!invitation}
                      autoComplete="username"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t('Password')}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
                    <Input 
                      id="password" 
                      type="password" 
                      placeholder="••••••••" 
                      className="pl-10" 
                      value={password} 
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete={isRegistering ? "new-password" : "current-password"}
                    />
                  </div>
                </div>

                {!isRegistering && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="remember"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      />
                      <label htmlFor="remember" className="text-sm text-zinc-600 cursor-pointer">
                        {t('Remember')}
                      </label>
                    </div>
                    <button 
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-sm font-medium text-zinc-900 hover:underline"
                    >
                      {t('Forgot password?')}
                    </button>
                  </div>
                )}

                <Button type="submit" className="w-full bg-zinc-900" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('Sign In')}
                </Button>
              </form>

              {!invitation && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-zinc-200" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-zinc-50 px-2 text-zinc-500">{t('Or continue with')}</span>
                    </div>
                  </div>

                  <Button variant="outline" onClick={handleGoogleLogin} className="w-full" disabled={loading}>
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Google
                  </Button>

                  <p className="text-center text-sm text-zinc-500">
                    {isRegistering ? t('Already have an account?') : t("Don't have an account?")}{' '}
                    <button onClick={() => setIsRegistering(!isRegistering)} className="font-medium text-zinc-900 hover:underline">
                      {t('Sign In')}
                    </button>
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

