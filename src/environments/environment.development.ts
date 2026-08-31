export const environment = {
	// require can be used because we will build the app and the compiler runs this command
	appVersion: require('../../package.json').version,
	// Empty by default so local development doesn't send events to production analytics.
	gaMeasurementId: '',
	// Same Firebase project as production is fine for dev — fill in to test sign-in/sync locally.
	firebaseConfig: {
		apiKey: 'AIzaSyAmTJ3-Vy293lJDTg3JD4-J4Ldo8Y4Hbws',
		authDomain: 'bible-audio-ab851.firebaseapp.com',
		projectId: 'bible-audio-ab851',
		storageBucket: 'bible-audio-ab851.firebasestorage.app',
		messagingSenderId: '708812956918',
		appId: '1:708812956918:web:db1f52d32fff77971b78d7'
	},
	vapidPublicKey: 'BIqmtyyf9OrlogdzourrlmHSQXQKSocKMAK86CWnlUx9J32priS9REg_SqxFcWzWE3yfXJPsVbf9Qu-V7qBDIYI'
};
