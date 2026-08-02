document.addEventListener('DOMContentLoaded', () =>{
    const decimalBtn = document.getElembentById('dec-convert-btn');
    const hexBtn = document.getElementById('hex-convert-btn');

    function DecimalConversion() {
        const input = document.getElementById('decimal-input').value;
        const resultBox = document.getElementById('decimal-result');
        const stepList = document.getElementById('decimal-steps');

        
        try{
            const result = window.IEEE754.convertDecimal(input);

            document.getElementById('decimal-binary').textContent = result.binary;
            document.getElementById('decimal-hex').textContent = result.hex;

            const f = result.fields;
            const mantissaStr = f.mantissaBits.join('');
            document.getElementById('decimal-fields').textContent = `${f.signBit} / ${f.exponentBits.join('')} / ${mantissaStr}`;

            document.getElementById('decimal-special').textContent = f.special ? f.special : 'None';
            document.getElementById('decimal-echo').textContent = result.decimalEcho;

            stepList.innerHTML = '';
            f.steps.forEach(stepText => {
                const li = document.createElement('li');
                li.textContent = stepText;
                stepList.appendChild(li);
            });

            resultBox.hidden = false;

        } catch (error) {
            document.getElementById('decimal-binary').textContent = '';
            document.getElementById('decimal-hex').textContent = '';
            document.getElementById('decimal-fields').textContent = '';
            document.getElementById('decimal-special').textContent = '';
            document.getElementById('decimal-echo').textContent = 'Error: ${error.message}';
            stepList.innerHTML = '';
            resultBox.hidden = false;
        }
    }
    

    function HexConversion() {
        const input = document.getElementById('hex-binary').textContent = '';
        const resultBox = document.getElementById('hex-result');

        try{
            const result = window.IEEE754.convertHexToDecimal(input);

            document.getElementById('hex-binary').textContent = result.binary;
            document.getElementById('hex-decimal').textContent = result.decimal;
            document.getElementById('hex-special').textContent = result.fields.special ? result.fields.special : 'None';

            resultBox.hidden = false;
            
        } catch (error) {
            document.getElementById('hex-binary').textContent = '';
            document.getElementById('hex-decimal').textContent = 'Error: ${error.message}';
            document.getElementById('hex-special').textContent = '';
            resultBox.hidden = false;
        }
    }

    decimalBtn.addEventListener('click', DecimalConversion);
    hexBtn.addEventListener('click', HexConversion);

    decimalConversion();
    hexConversion();
});