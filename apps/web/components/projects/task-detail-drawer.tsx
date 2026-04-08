'use client';

import { useState } from 'react';
import { X, MessageSquare, Send } from 'lucide-react';
import { useComments, useAddComment } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';

interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | Date | null;
  assigneeId?: string | null;
}

interface TaskDetailDrawerProps {
  task: Task | null;
  onClose: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  high:   'text-red-600 bg-red-50',
  medium: 'text-amber-600 bg-amber-50',
  low:    'text-slate-600 bg-slate-50',
};

export function TaskDetailDrawer({ task, onClose }: TaskDetailDrawerProps) {
  const [commentText, setCommentText] = useState('');
  const { data: comments = [], isLoading: loadingComments } = useComments(task?.id ?? '');
  const addComment = useAddComment(task?.id ?? '');

  if (!task) return null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment.mutate(commentText.trim(), {
      onSuccess: () => setCommentText(''),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-semibold text-slate-800 leading-tight">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${PRIORITY_COLORS[task.priority] ?? 'text-slate-600 bg-slate-50'}`}>
                {task.priority}
              </span>
              <span className="text-[10px] text-slate-500 capitalize">{task.status.replace(/_/g, ' ')}</span>
              {task.dueDate && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isOverdue ? 'bg-red-100 text-red-600 font-semibold' : 'bg-slate-100 text-slate-500'}`}>
                  Due {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {isOverdue ? ' (overdue)' : ''}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {task.description && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Comments {comments.length > 0 && `(${comments.length})`}
            </p>

            {loadingComments ? (
              <p className="text-xs text-slate-400">Loading...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-slate-400">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {(comments as any[]).map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5">
                      {(c.user?.firstName ?? c.userId)?.[0]?.toUpperCase() ?? 'U'}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-700">
                        {c.user ? `${c.user.firstName} ${c.user.lastName}` : 'User'}
                        <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                          {new Date(c.createdAt).toLocaleString()}
                        </span>
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Comment input */}
        <div className="border-t border-slate-200 px-6 py-4">
          <form onSubmit={handleAddComment} className="flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <Button type="submit" size="sm" disabled={!commentText.trim() || addComment.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
