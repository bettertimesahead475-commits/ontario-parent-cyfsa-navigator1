const res = await fetch('http://localhost:3000/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    textContent: process.env.TEST_ANALYZE_TEXT || '',
    model: 'claude-3-5-haiku-20241022',
    analysisMode: 'fast'
  })
});
const body = await res.json();
console.log(JSON.stringify({ status: res.status, body }, null, 2));
