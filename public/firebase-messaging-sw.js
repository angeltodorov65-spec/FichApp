// Scripts for firebase and firebase-messaging
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in the
// messagingSenderId.
firebase.initializeApp({
  apiKey: "AIzaSyAZk6OnRSCQuHq8B1o70Cj2Qq5vuY4V9fw",
  authDomain: "ai-studio-applet-webapp-1177b.firebaseapp.com",
  projectId: "ai-studio-applet-webapp-1177b",
  storageBucket: "ai-studio-applet-webapp-1177b.firebasestorage.app",
  messagingSenderId: "710333467211",
  appId: "1:710333467211:web:3847f5c245c9ba2980dbce"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Customize notification here
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
