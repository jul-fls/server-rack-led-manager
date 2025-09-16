// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

const statusRoutes = require('./src/routes/status');
const ledRoutes = require('./src/routes/led');
const rackUnitURoutes = require('./src/routes/rackUnitU');
const equipmentRoutes = require('./src/routes/equipment');
const maintenanceRoutes = require('./src/routes/maintenance');
const { setupWledWsProxy } = require('./src/routes/ws');
const testRoutes = require('./src/routes/test');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// mount routes
app.use('/api', statusRoutes);
app.use('/api', ledRoutes);
app.use('/api', rackUnitURoutes);
app.use('/api', equipmentRoutes);
app.use('/api', maintenanceRoutes);
app.use('/api', testRoutes);
app.use('/web', express.static('src/web'));

const server = app.listen(port, () => {
  console.log(`LED control server is running on http://localhost:${port}`);
});

setupWledWsProxy(server);

console.log(`Server is running on port ${port}`);
