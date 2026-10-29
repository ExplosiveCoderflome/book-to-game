import {createContext} from 'react';

export const WorkspaceAssist = createContext<((topic: string) => void) | null>(null);
