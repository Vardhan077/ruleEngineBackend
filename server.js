const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());


const connectDB = async () => {
    try {
        const uri = 'mongodb://localhost:27017/ruleEngine';
        await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
};

connectDB();
// Rule schema
const ruleSchema = new mongoose.Schema({
    ruleId: { type: String, required: true },
    ast: { type: Object, required: true }
});
const Rule = mongoose.model('Rule', ruleSchema);

// Helper function to remove outer parentheses
function removeOuterParentheses(expr) {
    expr = expr.trim();
    if (expr[0] === '(' && expr[expr.length - 1] === ')') {
        return expr.substring(1, expr.length - 1).trim();
    }
    return expr;
}

// Enhanced parsing logic to handle parentheses and complex expressions

// Create AST from rule string
function parseExpression(expr) {
    expr = expr.trim();

    // Remove outer parentheses if they don't affect the logical structure
    while (expr.startsWith('(') && expr.endsWith(')') && isBalanced(expr)) {
        expr = expr.slice(1, -1).trim();
    }

    // Check for operators
    if (expr.includes('AND') || expr.includes('OR')) {
        const operator = expr.includes('AND') ? 'AND' : 'OR';
        const parts = splitExpression(expr, operator);
        return {
            type: 'operator',
            value: operator,
            left: parseExpression(parts[0]),
            right: parseExpression(parts[1])
        };
    }

    // Clean up the expression before returning as an operand
    expr = cleanExpression(expr);
    return { type: 'operand', value: expr };
}

// Helper function to check if parentheses are balanced
function isBalanced(expr) {
    let depth = 0;
    for (let char of expr) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (depth < 0) return false; // More closing than opening
    }
    return depth === 0; // Balanced if depth is zero
}

// Helper function to split expression by operator while considering parentheses
function splitExpression(expr, operator) {
    let depth = 0;
    let parts = [];
    let currentPart = '';

    for (let char of expr) {
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ' ' && depth === 0) {
            if (currentPart.trim()) {
                parts.push(currentPart.trim());
                currentPart = '';
            }
            continue;
        }

        currentPart += char;

        if (currentPart.trim().endsWith(operator) && depth === 0) {
            parts.push(currentPart.slice(0, -operator.length).trim());
            currentPart = '';
        }
    }

    if (currentPart.trim()) {
        parts.push(currentPart.trim());
    }

    return parts;
}

// Helper function to clean up the expression
function cleanExpression(expr) {
    // Remove any leading/trailing whitespace
    return expr.trim();
}

// API to fetch all rules
app.get('/rule', async (req, res) => {
    console.log('Fetching rules...');
    try {
        const rules = await Rule.find({});
        console.log(rules);
        if (rules.length === 0) {
            return res.status(404).json({ message: 'No rules found' });
        }
        res.json({ rules });
    } catch (error) {
        console.log("errrrrrrrrr")
        res.status(500).json({ message: 'Error fetching rules', error });
    }
});

// API to create rule and store AST
app.post('/create-rule', async (req, res) => {
    const { ruleId, ruleString } = req.body;
    console.log("executed")
    try {
        const ast = parseExpression(ruleString);
        const newRule = new Rule({ ruleId, ast });
        await newRule.save();
        res.json({ message: 'Rule created successfully', ast });
    } catch (error) {
        res.status(500).json({ message: 'Error saving rule', error });
    }
});

// Function to combine multiple ASTs
function combineRules(rules, operator = 'AND') {
    if (rules.length === 1) return rules[0];

    const left = rules[0]; 
    const right = combineRules(rules.slice(1), operator); 

    return {
        type: 'operator',
        value: operator,
        left: left,
        right: right
    };
}

// API to combine rules
app.post('/combine-rules', async (req, res) => {
    const { ruleIds } = req.body;

    if (ruleIds.length < 1) {
        return res.status(400).json({ message: 'At least one rule must be selected' });
    }

    try {
        const rules = await Rule.find({ ruleId: { $in: ruleIds } });
        if (rules.length === 0) {
            return res.status(404).json({ message: 'No rules found with the provided IDs' });
        }
        const asts = rules.map(rule => rule.ast);
        const combinedAST = combineRules(asts, 'AND');
        res.json({ message: 'Rules combined successfully', combinedAST });
    } catch (error) {
        res.status(500).json({ message: 'Error combining rules', error });
    }
});

// Function to evaluate AST against the data
function evaluateNode(node, data) {
    if (node.type === 'operand') {
        const condition = node.value.trim();
        const match = condition.match(/(\w+)\s*(>|<|>=|<=|=|!=)\s*(['"]?\w+['"]?)/);

        if (!match) {
            throw new Error(`Invalid condition: ${condition}`);
        }

        const [_, leftOperand, operator, rightOperand] = match;
        const dataValue = data[leftOperand];

        const isNumberComparison = !isNaN(dataValue) && !isNaN(rightOperand);
        const parsedRightOperand = isNumberComparison ? parseFloat(rightOperand) : rightOperand.replace(/['"]/g, '');

        switch (operator) {
            case '>':
                return parseFloat(dataValue) > parsedRightOperand;
            case '<':
                return parseFloat(dataValue) < parsedRightOperand;
            case '>=':
                return parseFloat(dataValue) >= parsedRightOperand;
            case '<=':
                return parseFloat(dataValue) <= parsedRightOperand;
            case '=':
                return dataValue == parsedRightOperand;
            case '!=':
                return dataValue != parsedRightOperand;
            default:
                throw new Error(`Unknown operator: ${operator}`);
        }
    }

    const leftEval = evaluateNode(node.left, data);
    const rightEval = evaluateNode(node.right, data);

    if (node.value === 'AND') return leftEval && rightEval;
    if (node.value === 'OR') return leftEval || rightEval;
}

// API to evaluate rule
// app.post('/evaluate-rule', async (req, res) => {
//     const { ruleId, data } = req.body;

//     try {
//         const rule = await Rule.findOne({ ruleId });

//         if (!rule) {
//             return res.status(404).json({ message: 'Rule not found' });
//         }

//         const result = evaluateNode(rule.ast, data);
//         res.json({ result });
//     } catch (error) {
//         res.status(500).json({ message: 'Error evaluating rule', error });
//     }
// });

app.post('/evaluate-rule', async (req, res) => {
    const { ast, data } = req.body;

    try {
        const result = evaluateNode(ast, data);
        res.json({ result });
    } catch (error) {
        res.status(500).json({ message: 'Error evaluating rule', error });
    }
});

// API to get a rule by ID
app.get('/rule/:ruleId', async (req, res) => {
    const { ruleId } = req.params;

    try {
        const rule = await Rule.findOne({ ruleId });
        if (!rule) {
            return res.status(404).json({ message: 'Rule not found' });
        }

        res.json({ ast: rule.ast });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching rule', error });
    }
});


// Start server
app.listen(5000, () => {
    console.log('Server is running on port 5000');
});
