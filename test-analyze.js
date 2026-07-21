fetch('http://localhost:3000/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    textContent: process.env.TEST_ANALYZE_TEXT || '',
    model: 'claude-3-5-haiku-20241022',
    analysisMode: 'fast'
  })
})
  .then(res => res.json().then(body => ({ status: res.status, body })))
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
