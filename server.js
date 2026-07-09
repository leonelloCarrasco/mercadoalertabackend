require('dotenv').config({ quiet: true });
const app = require('./src/app');
const { iniciarCronJobs } = require('./src/jobs');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MercadoAlerta corriendo en http://localhost:${PORT}`);
  iniciarCronJobs();
});
