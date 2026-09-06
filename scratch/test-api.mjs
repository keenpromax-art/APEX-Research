import http from 'http';

async function testApi() {
  try {
    const res = await fetch('http://localhost:3000/api/company?symbol=TMCV.NS');
    console.log('API Status:', res.status);
    const data = await res.json();
    console.log('Company:', data.profile?.name, 'Ticker:', data.profile?.ticker);
  } catch (err) {
    console.error('Error fetching API:', err);
  }
}

testApi();
