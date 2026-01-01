const http = require('http');

const opts = { hostname: 'localhost', port: process.env.PORT || 3000, path: '/health', method: 'GET' };
const req = http.request(opts, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', ()=>{
    if (res.statusCode === 200) { console.log('OK', b); process.exit(0); }
    console.error('FAIL', res.statusCode, b); process.exit(1);
  });
});
req.on('error', e => { console.error('ERR', e.message); process.exit(2); });
req.end();
