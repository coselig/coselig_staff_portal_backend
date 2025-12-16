// test.js
const fetch = require('node-fetch');

async function main() {
  const res = await fetch('https://employeeservice.coseligtest.workers.dev/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '1234' })
  });

  const data = await res.json();
  console.log(data);
}

main();
