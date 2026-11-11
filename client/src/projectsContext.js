import { createContext } from 'react';

// all: every project folder [{ name, path, isRepo }]; recent: /api/claude/projects
// (recent sessions, claudeRunning). Empty when CLAUDE_PROJECT_DIRS isn't set.
// contextWarnTokens: sessions above this context size are flagged "save & clear".
export const ProjectsContext = createContext({ all: [], recent: [], contextWarnTokens: 400000 });
