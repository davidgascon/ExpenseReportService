(function () {
  // Egg: a friendly console message - only visible to anyone who pops open
  // devtools, which is exactly the point.
  console.log('%c🧾 Expense Reports', 'font-size:20px;font-weight:700;color:#2563eb;');
  console.log('%cPoking around in the console? Respect. Try the Konami code somewhere in the app.', 'color:#888;font-style:italic;');

  // Egg: the Konami code, anywhere in the app, triggers a brief confetti
  // burst - pure CSS/JS, no library.
  var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  var progress = 0;
  var COLORS = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed'];

  function burstConfetti() {
    for (var i = 0; i < 60; i++) {
      (function () {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
        piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
        piece.style.animationDelay = (Math.random() * 0.4) + 's';
        document.body.appendChild(piece);
        piece.addEventListener('animationend', function () { piece.remove(); });
      })();
    }
  }

  document.addEventListener('keydown', function (e) {
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[progress]) {
      progress++;
      if (progress === KONAMI.length) {
        progress = 0;
        burstConfetti();
      }
    } else {
      progress = key === KONAMI[0] ? 1 : 0;
    }
  });
})();
