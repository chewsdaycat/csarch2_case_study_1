document.addEventListener('DOMContentLoaded', () => {
  const opBtn = document.getElementById('op-btn');

  function runArithmetic() {
    const aStr = document.getElementById('op-a').value;
    const aKind = document.getElementById('op-a-kind').value;
    const bStr = document.getElementById('op-b').value;
    const bKind = document.getElementById('op-b-kind').value;
    const op = document.getElementById('op-type').value; // 'add' or 'multiply'
    const mode = document.getElementById('op-mode').value;

    const resultBox = document.getElementById('op-result');
    const stepsList = document.getElementById('op-steps');

    try {
      const result = window.IEEE754.arithmetic(aStr, aKind, bStr, bKind, op, mode);

      document.getElementById('op-binary').textContent = result.binary;
      document.getElementById('op-hex').textContent = result.hex;
      document.getElementById('op-decimal').textContent = result.decimal;

      // Clear previous steps before adding new ones
      stepsList.innerHTML = '';
      result.steps.forEach(stepText => {
        const li = document.createElement('li');
        li.textContent = stepText;
        stepsList.appendChild(li);
      });

      resultBox.hidden = false;
    } catch (e) {
      stepsList.innerHTML = '';
      document.getElementById('op-binary').textContent = '';
      document.getElementById('op-hex').textContent = '';
      document.getElementById('op-decimal').textContent = e.message;
      resultBox.hidden = false;
    }
  }

  opBtn.addEventListener('click', runArithmetic);

  // Show a worked example on page load
  runArithmetic();
});
