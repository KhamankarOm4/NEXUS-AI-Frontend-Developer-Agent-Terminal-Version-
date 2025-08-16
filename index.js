import { GoogleGenAI } from "@google/genai";
import readlineSync from 'readline-sync';
import { exec } from "child_process";
import { promisify } from "util";
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

const platform = os.platform();
const asyncExecute = promisify(exec);

const History = [];
const ai = new GoogleGenAI({ apiKey: "AIzaSyAU1N97GRP8J111EwrFk63YGzwpgL_Gnh8" });

// Enhanced tool that can execute terminal/shell commands with better error handling
async function executeCommand({command}) {
    let shellCommand = command;
    
    // Handle Windows PowerShell commands
    if (platform === "win32" && (/Set-Content|New-Item|Get-Content|@'/.test(command) || command.includes('|'))) {
        shellCommand = `powershell.exe -Command "${command.replace(/"/g, '\\"')}"`;
    }

    try {
        console.log("Executing command:", shellCommand);
        
        const { stdout, stderr } = await asyncExecute(shellCommand, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            timeout: 30000, // 30 second timeout
            cwd: process.cwd() // Ensure we're in the right directory
        });
        
        console.log("Stdout:", stdout);
        if (stderr) {
            console.log("Stderr:", stderr);
        }
        
        // Some commands naturally produce stderr output that isn't an error
        const isActualError = stderr && (
            stderr.toLowerCase().includes('error') ||
            stderr.toLowerCase().includes('failed') ||
            stderr.toLowerCase().includes('cannot') ||
            stderr.toLowerCase().includes('not found') ||
            stderr.toLowerCase().includes('permission denied') ||
            stderr.toLowerCase().includes('access denied')
        );
        
        if (isActualError) {
            return `Error: ${stderr}`;
        }
        
        return `Success: ${stdout || 'Command executed successfully'}${stderr ? ` (Note: ${stderr})` : ''}`;
        
    } catch(error) {
        console.log("Command failed:", shellCommand);
        console.log("Caught error:", error.message);
        
        // Provide more helpful error messages
        if (error.code === 'ENOENT') {
            return `Error: Command not found or path does not exist. Command: ${shellCommand}`;
        } else if (error.code === 'EACCES') {
            return `Error: Permission denied. Command: ${shellCommand}`;
        } else if (error.killed) {
            return `Error: Command timed out. Command: ${shellCommand}`;
        }
        
        return `Error: ${error.message}`;
    }
}

// Function to start a live server
async function startLiveServer(projectPath) {
    try {
        const fullPath = path.resolve(projectPath);
        console.log(`Starting live server for project at: ${fullPath}`);
        
        // Try different methods to start a live server
        const commands = [
            // Method 1: Using npx live-server (most common)
            `npx live-server "${fullPath}" --port=3000 --open`,
            // Method 2: Using Python's built-in server
            `cd "${fullPath}" && python -m http.server 8000`,
            // Method 3: Using Node.js http-server
            `npx http-server "${fullPath}" -p 8080 -o`,
            // Method 4: Using Python3
            `cd "${fullPath}" && python3 -m http.server 8000`
        ];
        
        for (const cmd of commands) {
            try {
                console.log(`Trying to start server with: ${cmd}`);
                
                // Start the server in the background
                const child = exec(cmd, { cwd: process.cwd() });
                
                child.stdout?.on('data', (data) => {
                    console.log('Server output:', data.toString());
                });
                
                child.stderr?.on('data', (data) => {
                    console.log('Server error:', data.toString());
                });
                
                // Give the server a moment to start
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                return `Success: Live server started! The website should open automatically in your browser. If not, check the console for the URL.`;
                
            } catch (error) {
                console.log(`Failed to start server with ${cmd}:`, error.message);
                continue;
            }
        }
        
        return `Error: Could not start live server. Please install live-server globally with: npm install -g live-server`;
        
    } catch (error) {
        return `Error: Failed to start live server - ${error.message}`;
    }
}

// Alternative function for file operations using Node.js fs (more reliable for complex content)
async function writeFileContent(filePath, content) {
    try {
        await fs.writeFile(filePath, content, 'utf8');
        return `Success: File written successfully to ${filePath}`;
    } catch (error) {
        return `Error: Failed to write file - ${error.message}`;
    }
}

async function readFileContent(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return `Success: File content:\n${content}`;
    } catch (error) {
        return `Error: Failed to read file - ${error.message}`;
    }
}

const executeCommandDeclaration = {
    name: "executeCommand",
    description: "Execute a single terminal/shell command. Can create folders, files, write content, edit files, or delete files. For complex file writing operations, prefer using cat with here-documents (Linux/Mac) or PowerShell Set-Content with here-strings (Windows).",
    parameters: {
        type: 'OBJECT',
        properties: {
            command: {
                type: 'STRING',
                description: 'A single terminal command. Examples: "mkdir calculator", "ls -la", "cat file.txt"'
            },
        },
        required: ['command']   
    }
};

const writeFileDeclaration = {
    name: "writeFile",
    description: "Write content to a file using Node.js fs (alternative to shell commands for complex content)",
    parameters: {
        type: 'OBJECT',
        properties: {
            filePath: {
                type: 'STRING',
                description: 'Path to the file to write'
            },
            content: {
                type: 'STRING',
                description: 'Content to write to the file'
            }
        },
        required: ['filePath', 'content']
    }
};

const readFileDeclaration = {
    name: "readFile",
    description: "Read content from a file using Node.js fs",
    parameters: {
        type: 'OBJECT',
        properties: {
            filePath: {
                type: 'STRING',
                description: 'Path to the file to read'
            }
        },
        required: ['filePath']
    }
};

const startLiveServerDeclaration = {
    name: "startLiveServer",
    description: "Start a live development server for the created project",
    parameters: {
        type: 'OBJECT',
        properties: {
            projectPath: {
                type: 'STRING',
                description: 'Path to the project directory to serve'
            }
        },
        required: ['projectPath']
    }
};

const availableTools = {
    executeCommand,
    writeFile: async ({filePath, content}) => writeFileContent(filePath, content),
    readFile: async ({filePath}) => readFileContent(filePath),
    startLiveServer: async ({projectPath}) => startLiveServer(projectPath)
};

async function runAgent(userProblem) {
    History.push({
        role: 'user',
        parts: [{text: userProblem}]
    });

    while(true) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: History,
                config: {
                    systemInstruction: `You are an expert AI agent specializing in automated frontend web development. Your mission is to build complete, functional, and visually appealing websites based on user requests. You have access to four powerful tools: 'executeCommand', 'writeFile', 'readFile', and 'startLiveServer'.

Your user's operating system is: ${platform}

<-- CORE MISSION: Build Professional-Grade Websites -->
You don't just create basic websites - you create impressive, modern, responsive web applications with:
- Clean, professional design with modern UI/UX principles
- Responsive layouts that work on all devices
- Interactive elements and smooth animations
- Proper semantic HTML structure
- Well-organized, maintainable CSS
- Functional JavaScript with modern ES6+ features
- Accessibility considerations
- Cross-browser compatibility

<-- WORKFLOW: PLAN -> EXECUTE -> VALIDATE -> REPEAT -> LAUNCH -->
1. **PLAN**: Decide on the next logical action
2. **EXECUTE**: Use the appropriate tool
3. **VALIDATE**: Verify the action completed successfully
4. **REPEAT**: Continue until website is complete
5. **LAUNCH**: Automatically start live server when done

<-- TOOL SELECTION GUIDE -->
- **executeCommand**: Directory operations, file management, system commands
- **writeFile**: Creating HTML, CSS, JavaScript files (preferred for code)
- **readFile**: Verify file contents and debug issues
- **startLiveServer**: Launch the website in browser (ALWAYS use this at the end)

<-- WEBSITE ARCHITECTURE STANDARDS -->

**HTML Structure:**
- Use semantic HTML5 elements (header, nav, main, section, article, aside, footer)
- Include proper meta tags (viewport, description, charset)
- Link external resources properly
- Use meaningful class names and IDs
- Include accessibility attributes (alt, aria-labels, roles)

**CSS Best Practices:**
- Use CSS Grid and Flexbox for layouts
- Implement responsive design with media queries
- Use CSS custom properties (variables) for consistency
- Include smooth transitions and hover effects
- Follow modern design trends (clean typography, good spacing, color harmony)
- Use box-sizing: border-box for all elements

**JavaScript Standards:**
- Use modern ES6+ syntax (const/let, arrow functions, template literals)
- Implement proper event handling
- Create modular, reusable functions
- Include error handling
- Add interactive features that enhance user experience

<-- DESIGN PRINCIPLES -->
**Color Schemes:** Use harmonious color palettes (consider tools like coolors.co principles)
**Typography:** Combine 2-3 fonts maximum, ensure good hierarchy
**Spacing:** Consistent margins/padding, use of whitespace
**Visual Hierarchy:** Clear information architecture
**Interactive Elements:** Buttons, forms, navigation with proper states
**Performance:** Optimize images, minimize CSS/JS, use efficient selectors

<-- PROJECT CREATION WORKFLOW -->
1. **Create project directory** with descriptive name
2. **Set up file structure**: index.html, styles.css, script.js
3. **Build HTML foundation** with proper structure and content
4. **Style with CSS** - mobile-first responsive design
5. **Add JavaScript functionality** for interactivity
6. **Validate each file** after creation
7. **Launch live server** to demonstrate the working website

<-- CONTENT CREATION GUIDELINES -->
**For HTML:**
- Include a compelling title and meta description
- Create meaningful content, not just "Lorem ipsum"
- Structure content logically with proper headings
- Include call-to-action elements where appropriate

**For CSS:**
- Start with CSS reset/normalize
- Use mobile-first approach
- Create smooth transitions and micro-interactions
- Implement proper hover/focus states
- Use modern CSS features (Grid, Flexbox, custom properties)

**For JavaScript:**
- Add meaningful interactivity (not just alerts)
- Implement features like: smooth scrolling, form validation, dynamic content
- Use event delegation and proper event handling
- Include loading states and error handling

<-- COMMON PROJECT TYPES & FEATURES -->
**Landing Pages:** Hero sections, feature cards, testimonials, contact forms
**Portfolios:** Project galleries, skill showcases, contact information
**Business Sites:** Services sections, about pages, contact forms
**Web Apps:** Interactive dashboards, calculators, games, tools
**E-commerce:** Product displays, shopping carts, checkout processes

<-- FINAL STEP: AUTO-LAUNCH -->
After completing the website:
1. Validate all files are created and contain proper code
2. **AUTOMATICALLY call startLiveServer** with the project path
3. Provide a summary of what was built and features included
4. Mention that the live server is running and the site should open automatically

<-- ERROR HANDLING & QUALITY ASSURANCE -->
- Always validate file contents after writing
- If errors occur, troubleshoot and provide alternatives
- Ensure all files are properly linked (CSS/JS to HTML)
- Test responsive design principles in code
- Include console.log statements for debugging JavaScript

<-- RESPONSIVE DESIGN BREAKPOINTS -->
- Mobile: 320px - 768px
- Tablet: 768px - 1024px  
- Desktop: 1024px+

Remember: You're not just creating files - you're crafting experiences. Every website should be something the user would be proud to show others. Always end by launching the live server automatically!`,
                    tools: [{
                        functionDeclarations: [executeCommandDeclaration, writeFileDeclaration, readFileDeclaration, startLiveServerDeclaration]
                    }],
                },
            });

            if (response.functionCalls && response.functionCalls.length > 0) {
                console.log("Function calls:", response.functionCalls);
                
                const { name, args } = response.functionCalls[0];
                const funCall = availableTools[name];
                
                if (!funCall) {
                    console.error(`Unknown function: ${name}`);
                    break;
                }
                
                const result = await funCall(args);

                const functionResponsePart = {
                    name: name,
                    response: {
                        result: result,
                    },
                };

                // Add model's function call to history
                History.push({
                    role: "model",
                    parts: [
                        {
                            functionCall: response.functionCalls[0],
                        },
                    ],
                });

                // Add function result to history
                History.push({
                    role: "user",
                    parts: [
                        {
                            functionResponse: functionResponsePart,
                        },
                    ],
                });
            } else {
                // No function calls - model is providing final response
                History.push({
                    role: 'model',
                    parts: [{text: response.text}]
                });
                console.log(response.text);
                break;
            }
        } catch (error) {
            console.error("Error in runAgent:", error);
            console.log("An error occurred. Please try again.");
            break;
        }
    }
}

async function main() {
    console.log("🚀 AI Frontend Developer Agent - Professional Website Builder");
    console.log("================================================");
    console.log("I can create modern, responsive websites with:");
    console.log("• Professional design & animations");
    console.log("• Mobile-first responsive layouts"); 
    console.log("• Interactive JavaScript features");
    console.log("• Auto-launch in live server");
    console.log("================================================");
    
    while (true) {
        try {
            const userProblem = readlineSync.question("\n💡 What website would you like me to build? (type 'exit' to quit): ");
            
            if (userProblem.toLowerCase() === 'exit') {
                console.log("👋 Thanks for using AI Frontend Developer Agent!");
                break;
            }
            
            if (userProblem.trim() === '') {
                console.log("❌ Please provide a valid website request.");
                continue;
            }
            
            console.log(`\n🔨 Building your website: "${userProblem}"`);
            console.log("This may take a moment...\n");
            
            await runAgent(userProblem);
            
            console.log("\n✅ Website creation process completed!");
            console.log("📁 Check your current directory for the new project files");
            
        } catch (error) {
            console.error("❌ Error in main loop:", error);
            console.log("🔄 An error occurred. Let's try again.");
        }
    }
}

main().catch(console.error);