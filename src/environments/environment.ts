export const environment = {
	production: true,
	// require can be used because we will build the app and the compiler runs this command
	appVersion: require('../../package.json').version
};
