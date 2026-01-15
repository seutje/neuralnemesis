# AGENTS.md: AI Execution Protocol for Neural Nemesis

## 1. Directives & Safety Protocols

### 1.1 Environment Context
* **OS:** Ubuntu (WSL). Assume standard Linux file paths and permissions.
* **Root Directory:** You are strictly confined to the project root directory defined by the user. Do **not** navigate to `~`, `/`, or `/mnt/c/` unless explicitly instructed to fetch external assets.
* **Package Managers:** Use `npm` for JavaScript/Web and `pip` (within a virtual environment) for Python/ML.

### 1.2 Data Integrity & Safety
* **Deletion Policy:** You are **strictly forbidden** from running `rm`, `rm -rf` without first:
    1.  Verifying the file is a build artifact (e.g., `dist/`, `__pycache__`).
    2.  Asking the user for explicit confirmation if it is source code.
* **File Creation:** Always create files with appropriate permissions (`644` for files, `755` for scripts).

### 1.3 Documentation Authority
* **Primary Source of Truth:** `DESIGN.md` contains the architectural logic, math formulations, and hyperparameter definitions.
* **Execution Roadmap:** `PLAN.md` contains the verifiable steps you must follow. Do not skip phases.
* **Conflict Resolution:** If `PLAN.md` instructions conflict with `DESIGN.md` architecture, prioritize `DESIGN.md` but notify the user of the discrepancy.

---

## 2. Project Structure Standard

You must enforce the following directory structure. Create missing directories as needed.

```text
neural-nemesis/
├── AGENTS.md           # This file
├── DESIGN.md           # Architecture & Math
├── PLAN.md             # Implementation phases
├── backend_train/      # Python/Gym Environment
│   ├── envs/           # Custom Gym environments
│   ├── models/         # Saved .zip models
│   ├── train.py        # Main training script
│   └── requirements.txt
├── frontend_web/       # Phaser/TFJS Game
│   ├── public/
│   │   └── assets/     # Sprites, sounds, model.json
│   ├── src/
│   │   ├── ai/         # Worker & TFJS logic
│   │   ├── game/       # Phaser scenes & physics
│   │   └── main.js     # Entry point
│   ├── index.html
│   └── package.json
└── scripts/            # Helper bash scripts (build, convert)

```

---

## 3. Operational Workflows

### 3.1 Python Training (Phase 1)

* **Virtual Env:** Always check for `venv`. If missing: `python3 -m venv venv`.
* **Activation:** `source venv/bin/activate`.
* **Execution:** When running training scripts, ensure you log TensorBoard metrics to `./logs`. Don't run long running training scripts yourself, instruct the user to run them. Only use short testing runs during development.
* **Export:** When converting models for TFJS, use a dedicated output folder `frontend_web/public/assets/model/`.

### 3.2 Web Development (Phase 2-5)

* **Bundler:** Use `Vite` or `Webpack`. Prefer Vite for speed.
* **Local Server:** Use `npm run dev` to serve. Do not assume port 80 or 443 are open; default to 3000 or 5173.
* **Workers:** Ensure `Worker` scripts are treated as modules if using ES6 imports (`type: "module"`).

---

## 4. Verification Checklists

Before marking a task from `PLAN.md` as "Complete," you must run the following validation:

1. **Code Validity:** Does the code parse? (e.g., `node --check file.js` or `python -m py_compile file.py`).
2. **Reference Check:** Does the implementation match the math in `DESIGN.md`? (e.g., Reward function  values).
3. **File Existence:** Are the expected output files (e.g., `model.json`) actually present in the target directory?

## 5. Interaction Style

* **Concise:** Do not output wall-of-text explanations unless asked. Output code or shell commands.
* **Iterative:** Implement one sub-bullet of `PLAN.md` at a time.
* **Error Handling:** If a command fails, output the specific error log and suggest a fix immediately. do not hallucinate a success.

---

**End of Protocol**