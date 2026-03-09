/**
 * Tool detection status
 */
export interface ToolStatus {
  available: boolean;
  error?: string;
  lastChecked?: Date;
  path?: string;
  version?: string;
}

/**
 * Tool categories
 */
export type ToolCategory =
  | 'content-search'
  | 'ast-search'
  | 'file-search'
  | 'browser-automation'
  | 'system'
  | 'custom';

/**
 * Tool info for display
 */
export interface ToolInfo {
  description?: string;
  name: string;
  priority?: number;
}
