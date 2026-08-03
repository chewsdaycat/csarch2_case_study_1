document.addEventListener('DOMContentLoaded', () => {
    const decimalBtn = document.getElementById('dec-convert-btn');
    const hexBtn = document.getElementById('hex-convert-btn');

    function DecimalConversion() {
        const input = document.getElementById('dec-input').value;
        const resultBox = document.getElementById('dec-result');
        const stepList = document.getElementById('dec-steps');

        try {
            const result = window.IEEE754.convertDecimal(input);

            document.getElementById('dec-binary').textContent = result.binary;
            document.getElementById('dec-hex').textContent = result.hex;

            const f = result.fields;
            const mantissaStr = f.mantissaBits.join('');
            document.getElementById('dec-fields').textContent = `${f.sign} / ${f.exponentBits} / ${mantissaStr}`;

            document.getElementById('dec-special').textContent = f.special ? f.special : 'None';
            document.getElementById('dec-echo').textContent = result.decimalEcho;

            stepList.innerHTML = '';
            f.steps.forEach(stepText => {
                const li = document.createElement('li');
                li.textContent = stepText;
                stepList.appendChild(li);
            });

            resultBox.hidden = false;

        } catch (error) {
            document.getElementById('dec-binary').textContent = '';
            document.getElementById('dec-hex').textContent = '';
            document.getElementById('dec-fields').textContent = '';
            document.getElementById('dec-special').textContent = '';
            document.getElementById('dec-echo').textContent = `Error: ${error.message}`;
            stepList.innerHTML = '';
            resultBox.hidden = false;
        }
    }

    function HexConversion() {
        const input = document.getElementById('hex-input').value;
        const resultBox = document.getElementById('hex-result');

        try {
            const result = window.IEEE754.convertHexToDecimal(input);

            document.getElementById('hex-binary').textContent = result.binary;
            document.getElementById('hex-decimal').textContent = result.decimal;
            document.getElementById('hex-special').textContent = result.fields.special ? result.fields.special : 'None';

            resultBox.hidden = false;

        } catch (error) {
            document.getElementById('hex-binary').textContent = '';
            document.getElementById('hex-decimal').textContent = `Error: ${error.message}`;
            document.getElementById('hex-special').textContent = '';
            resultBox.hidden = false;
        }
    }

    decimalBtn.addEventListener('click', DecimalConversion);
    hexBtn.addEventListener('click', HexConversion);

    // Show worked examples on page load
    DecimalConversion();
    HexConversion();
});
