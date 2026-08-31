export const environment = {
	production: true,
	// require can be used because we will build the app and the compiler runs this command
	appVersion: require('../../package.json').version,
	// GA4 Measurement ID (e.g. "G-XXXXXXXXXX"). Leave empty to disable analytics.
	gaMeasurementId: 'G-S45D0H9W7B',
	// Firebase project config (from the Firebase console > Project settings).
	// Leave apiKey empty to disable sign-in/cloud sync entirely.
	firebaseConfig: {
		apiKey: 'AIzaSyAmTJ3-Vy293lJDTg3JD4-J4Ldo8Y4Hbws',
		authDomain: 'bible-audio-ab851.firebaseapp.com',
		projectId: 'bible-audio-ab851',
		storageBucket: 'bible-audio-ab851.firebasestorage.app',
		messagingSenderId: '708812956918',
		appId: '1:708812956918:web:db1f52d32fff77971b78d7'
	},
	// VAPID public key for Web Push subscriptions (safe to expose client-side —
	// the matching private key lives server-side only, as a Vercel env var).
	vapidPublicKey: 'BIqmtyyf9OrlogdzourrlmHSQXQKSocKMAK86CWnlUx9J32priS9REg_SqxFcWzWE3yfXJPsVbf9Qu-V7qBDIYI'
};
