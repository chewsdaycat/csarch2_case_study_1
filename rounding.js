document.addEventListener('DOMContentLoaded', () => {
  const roundBtn = document.getElementById('round-btn');
  const tbody = document.getElementById('round-tbody');
  const resultBox = document.getElementById('round-result');

  const performRounding = () => {
    const kind = document.getElementById('round-kind').value;
    const input = document.getElementById('round-input').value;
    const bits = parseInt(document.getElementById('round-bits').value, 10);

    if (isNaN(bits) || bits < 1 || bits > 52) {
      alert('Error: Target number of mantissa bits must be between 1 and 52.');
      return;
    }

    try {
      const results = window.IEEE754.demonstrateRounding(input, kind, bits);
      
      tbody.innerHTML = '';
      const labels = {
        chop: 'Chopping (Truncation)',
        up: 'Round Up (+∞)',
        down: 'Round Down (-∞)',
        nearest_even: 'Round to Nearest (Ties to Even)'
      };

      for (const mode of ['chop', 'up', 'down', 'nearest_even']) {
        const row = document.createElement('tr');
        
        const methodCell = document.createElement('td');
        methodCell.textContent = labels[mode] || mode;
        
        const resultCell = document.createElement('td');
        const res = results[mode];
        resultCell.textContent = `${res.bits} × 2^${res.exp}`;
        
        row.appendChild(methodCell);
        row.appendChild(resultCell);
        tbody.appendChild(row);
      }

      resultBox.hidden = false;
    } catch (e) {
      alert(`Error: ${e.message}`);
      resultBox.hidden = true;
    }
  };

  roundBtn.addEventListener('click', performRounding);

  // Trigger the button once here so the page shows a
  // worked example on load.
  performRounding();
});
