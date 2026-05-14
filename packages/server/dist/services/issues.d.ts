export type ColumnStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export interface ListIssuesFilters {
    status?: ColumnStatus;
    labelId?: string;
    search?: string;
}
export declare function listIssues(projectId: string, filters?: ListIssuesFilters): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    projectId: string;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    title: string;
    body: string | null;
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
}[]>;
export declare function getIssue(projectId: string, id: string): Promise<{
    comments: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        body: string;
        issueId: string;
        authorId: string | null;
        githubCommentId: string | null;
    }[];
    labels: {
        id: string;
        name: string;
        createdAt: Date;
        projectId: string;
        color: string;
    }[];
    id: string;
    createdAt: Date;
    updatedAt: Date;
    projectId: string;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    title: string;
    body: string | null;
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
} | null>;
export declare function createIssue(projectId: string, data: {
    title: string;
    body?: string;
    status?: ColumnStatus;
    assigneeId?: string;
}): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    projectId: string;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    title: string;
    body: string | null;
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
}>;
export declare function updateIssue(projectId: string, id: string, data: {
    title?: string;
    body?: string;
    status?: ColumnStatus;
    assigneeId?: string | null;
}): Promise<{
    id: string;
    projectId: string;
    title: string;
    body: string | null;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
    createdAt: Date;
    updatedAt: Date;
} | null>;
export declare function archiveIssue(projectId: string, id: string): Promise<{
    id: string;
    projectId: string;
    title: string;
    body: string | null;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
    createdAt: Date;
    updatedAt: Date;
} | null>;
export declare function moveIssue(projectId: string, id: string, newStatus: ColumnStatus, position?: number): Promise<{
    id: string;
    projectId: string;
    title: string;
    body: string | null;
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
    assigneeId: string | null;
    position: number;
    archived: number;
    version: number;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
    createdAt: Date;
    updatedAt: Date;
} | null>;
export declare function bulkAction(projectId: string, action: 'move' | 'label' | 'archive', issueIds: string[], payload?: {
    status?: ColumnStatus;
    labelIds?: string[];
}): Promise<{
    affected: number;
}>;
export declare function listComments(issueId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    body: string;
    issueId: string;
    authorId: string | null;
    githubCommentId: string | null;
}[]>;
export declare function addComment(issueId: string, body: string, authorId?: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    body: string;
    issueId: string;
    authorId: string | null;
    githubCommentId: string | null;
}>;
export declare function deleteComment(issueId: string, commentId: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    body: string;
    issueId: string;
    authorId: string | null;
    githubCommentId: string | null;
}>;
export declare function listLabels(projectId: string): Promise<{
    id: string;
    name: string;
    createdAt: Date;
    projectId: string;
    color: string;
}[]>;
export declare function createLabel(projectId: string, name: string, color?: string): Promise<{
    id: string;
    name: string;
    createdAt: Date;
    projectId: string;
    color: string;
}>;
export declare function setIssueLabels(projectId: string, issueId: string, labelIds: string[]): Promise<{
    issueId: string;
    labelIds: string[];
} | null>;
//# sourceMappingURL=issues.d.ts.map