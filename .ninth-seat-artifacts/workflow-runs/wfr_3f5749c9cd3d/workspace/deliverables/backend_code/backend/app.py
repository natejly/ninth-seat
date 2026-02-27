from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.get_json()
    operand1 = data.get('operand1')
    operand2 = data.get('operand2')
    operation = data.get('operation')

    if operand1 is None or operand2 is None or operation is None:
        return jsonify({'error': 'Missing operand or operation', 'result': None}), 400

    try:
        operand1 = float(operand1)
        operand2 = float(operand2)
    except ValueError:
        return jsonify({'error': 'Operands must be numbers', 'result': None}), 400

    result = None
    error = None

    if operation == '+':
        result = operand1 + operand2
    elif operation == '-':
        result = operand1 - operand2
    elif operation == '*':
        result = operand1 * operand2
    elif operation == '/':
        if operand2 == 0:
            error = 'Division by zero error'
        else:
            result = operand1 / operand2
    else:
        error = 'Unsupported operation'

    if error:
        return jsonify({'error': error, 'result': None}), 400
    else:
        return jsonify({'error': None, 'result': result})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
