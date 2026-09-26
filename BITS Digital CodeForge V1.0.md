![][image1]

**BITS Digital CodeForge V1.0**  
---

**🧩 WHAT ARE YOU GETTING?**

You will receive the source code of a sample Grading Console created specifically for this activity.

Important: This is NOT an official BITS Pilani Digital grading tool and is not used for actual academic grading. Think of it as a working prototype created for this challenge — one that you now get to break, fix and reimagine. 😎

The application currently allows an instructor to:

* Upload an Excel file containing student marks  
* Select a course  
* View basic marks analytics  
* Configure grade ranges  
* See the resulting grade distribution  
* Validate grade ranges  
* Export the final grades as a CSV file

---

📊 **BEFORE YOU START — UNDERSTAND THE INPUT FILE**

The application reads marks from an Excel (.xlsx) file.

For the current version, the Excel file should contain exactly three columns:

| Student’s BITS ID | Course | Total Marks *(out of 100\)* |
| ----- | ----- | ----- |
| 2024XXXX | Course A | 82 |
| 2024YYYY | Course A | 71 |
| 2024ZZZZ | Course A | 64 |

A few important rules:

• BITS ID → Student's BITS ID  
• Course → Course name  
• Total Marks → Student's total marks, entered as a whole number  
• The application currently expects marks on a 0–100 scale  
• Students who did not appear for the examination and are to receive an NC grade should **NOT** be included in the file.

Once the file is uploaded, the application reads the course names and allows the user to select a course for grading.

The application then works with grade bands such as:

A | A- | B | B- | C | C- | D | E

The default grading ranges are:

A: 80–100 | A-: 70–79 | B: 60–69 | B-: 50–59 | C: 40–49 | C-: 30–39 | D: 20–29 | E: 0–19

You are free to rethink how this experience works after you have fixed the existing application.

---

**🐛 STAGE 1 — DEBUG**

Here's where things get interesting.

The code you receive will contain intentional bugs.

Your first job is to explore the application, identify what isn't working correctly, understand why, and fix it.

Don't just fix the error.

Understand the problem.

And document what you have done.

📋 Your Bug Fix Log

Please maintain your bug fixes in the following format:

| \# | Bug / Issue Identified | How You Reproduced It | Root Cause | Fix Implemented | How You Tested the Fix |
| ----- | ----- | ----- | ----- | ----- | ----- |
| 1 | Course list duplicates after uploading another file | Uploaded two Excel files sequentially | Existing course options were not cleared | Cleared existing options before adding new courses | Uploaded 2 files and verified unique course list |
| 2 | Average shows an incorrect value when no students are present | Selected a course with no records | Average calculation was performed on an empty dataset | Added empty-data handling | Tested with an empty course |
| 3 | *Your bug here* | *Your test* | *Your diagnosis* | *Your solution* | *Your verification* |

Please use this structure for your submission.

You don't have to use these example bugs — they are only examples of the format we expect.

---

**🚀 STAGE 2 — REIMAGINE**

Once you've fixed the application, don't stop there.

Now imagine that you are the product team responsible for turning this basic prototype into a professional-grade grading console.

Ask yourself:

> If I were an instructor using this application, what would make my experience faster, clearer, safer and more intuitive?

You can improve:

🎨 UI / Visual Design  
📊 Analytics & Visualisations  
⚡ Interactions & User Experience  
🧠 Product Features  
🛡️ Validation & Error Handling  
📱 Responsiveness  
♿ Accessibility  
📥 Export Experience  
💡 Anything else that genuinely improves the product

**Your challenge:**

Add at least 3 meaningful enhancements.

But remember:

> More features ≠ better product.

We are looking for thoughtful improvements that solve real user problems — not just more buttons, animations or colours. 😉

The core functionality of the grading console should continue to work correctly after your enhancements.

---

**🌐 STAGE 3 — DEPLOY**

Your work doesn't end when it works on your laptop.

Put it on the internet.

You can use platforms such as:

* Lovable  
* GitHub / GitHub Pages  
* Vercel  
* Netlify  
* or another deployment platform of your choice.

You may also use AI-assisted development tools such as ChatGPT, Lovable, GitHub Copilot, Cursor, etc.

**The goal is simple:**

We should be able to click your URL and use your application.

**🧑‍💻 NEVER DEPLOYED AN APP BEFORE??**

No worries. Here's a simple starting path:

1️⃣ Download the code  
Open the HTML file in your browser and first understand what the application does.

2️⃣ Explore before changing anything  
Upload the sample Excel file and try the different functions.

3️⃣ Find the bugs  
Try different inputs and workflows. Use your browser's Developer Tools / Console if you need help identifying errors.

4️⃣ Fix & document  
Fix the issues you discover and maintain your Bug Fix Log.

5️⃣ Start thinking like a product designer  
Once the application works, ask:  
*“What would make this significantly better for the person using it?”*

6️⃣ Build your enhancements  
Use the tools available to you. AI can help you understand unfamiliar code, troubleshoot errors and build new functionality — but make sure you understand what you are changing.

7️⃣ Test everything  
Don't assume that a new feature works just because it looks good.

8️⃣ Deploy it  
Generate a public URL that anyone can open.

9️⃣ Submit your work  
Share your public URL, GitHub repository (if applicable), Bug Fix Log and a short summary of your enhancements.

**🏆 HOW WILL YOUR WORK BE EVALUATED?**

Your submission will be evaluated across:

| Area | What we'll look for |
| ----- | ----- |
| 🐛 Debugging | How effectively you identify and fix the issues |
| ✅ Functionality | Whether the core application continues to work correctly |
| 💡 Creativity | Quality and originality of your enhancements |
| 🎨 User Experience | How intuitive, polished and professional the application feels |
| 🧠 Product Thinking | Whether your improvements solve meaningful user problems |
| 💻 Technical Execution | Quality and robustness of the implementation |
| 🌐 Deployment | Whether your final product is accessible and usable online |

You are not expected to be an expert developer. 

We're interested in how you think, experiment, solve problems and build.

All the best\!

[image1]: <data:image/png;base64,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>