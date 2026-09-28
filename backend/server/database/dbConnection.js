const mongoose = require('mongoose');

const dbConnection = () => {
  // Fail loudly and immediately with a clear message rather than letting mongoose.connect(undefined)
  // produce its generic "uri parameter must be a string, got undefined" error - this is exactly
  // what happens when DB_URI isn't actually loaded from any env file. Never logs the URI itself.
  if (!process.env.DB_URI) {
    console.error('Database configuration: FAILED - DB_URI environment variable is required (checked config.env and .env).');
    process.exit(1);
  }

  mongoose
    .connect(process.env.DB_URI)
    .then(conn => {
      console.log(`Database connection: OK (host: ${conn.connection.host}, db: ${conn.connection.name})`);
    })
    .catch(err => {
      // Deliberately does not log err.message: for a malformed URI, the MongoDB driver's own
      // parse-error message echoes the URI (credentials included) back verbatim. err.name/code
      // are safe - they never contain the connection string.
      console.error(`Database connection: FAILED (${err.name}${err.code ? `, code ${err.code}` : ''})`);
      console.error('Check that DB_URI in config.env/.env is a valid, reachable MongoDB connection string.');
      process.exit(1);
    });
};

module.exports = dbConnection;
