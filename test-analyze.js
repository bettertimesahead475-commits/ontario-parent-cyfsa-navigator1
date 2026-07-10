fetch('http://localhost:3000/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ textContent: "CAS visited my home today and said it was messy. I was stressed.", model: "gemini-2.5-flash" })
}).then(r => r.json()).then(console.log).catch(console.error);
