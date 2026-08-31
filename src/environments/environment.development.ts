export const environment = {
	// require can be used because we will build the app and the compiler runs this command
	appVersion: require('../../package.json').version,
	// Empty by default so local development doesn't send events to production analytics.
	gaMeasurementId: ''
};
