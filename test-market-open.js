const d = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
console.log(d);
const istDate = new Date(d);
const day = istDate.getDay();
const mins = istDate.getHours() * 60 + istDate.getMinutes();
console.log('day', day, 'mins', mins);
console.log('open?', mins >= 555 && mins <= 930 && day !== 0 && day !== 6);
