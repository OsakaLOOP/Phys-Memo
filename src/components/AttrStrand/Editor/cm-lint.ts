import { linter } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { atomMapField } from './cm-plugins';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import type { ContentAtomField } from '../../../attrstrand/types';

export const atomBoundaryLinter = (field: ContentAtomField) => linter((view: EditorView) => {
    const diagnostics: Diagnostic[] = [];
    const mappings = view.state.field(atomMapField);
    let hasUnexpectedInterruption = false;

    // Check boundaries between atoms
    for (let i = 0; i < mappings.length - 1; i++) {
        const currentAtom = mappings[i];
        const nextAtom = mappings[i + 1];

        const gapFrom = currentAtom.to;
        const gapTo = nextAtom.from;

        if (gapFrom < gapTo) {
            const gapText = view.state.sliceDoc(gapFrom, gapTo);
            
            // Expected is exactly "\n\n"
            if (gapText !== '\n\n') {
                // Determine the exact error type
                if (!/^[\n]*$/.test(gapText)) {
                    // Contains characters other than newline
                    hasUnexpectedInterruption = true;
                    diagnostics.push({
                        from: gapFrom,
                        to: gapTo,
                        severity: 'error',
                        message: 'AtomBlockBoundaryError: UnexpectedInterruption (段落间发现意外的非空字符，提交时将被拦截)',
                        source: 'boundary-linter'
                    });
                } else if (gapText.length < 2) {
                    // Only newlines, but too few
                    diagnostics.push({
                        from: gapFrom,
                        to: gapTo,
                        severity: 'error',
                        message: 'AtomBlockBoundaryError: MissingLineBreak (缺少换行符，应有两行空白，保存时将自动修正)',
                        source: 'boundary-linter'
                    });
                } else if (gapText.length > 2) {
                    // Only newlines, but too many
                    diagnostics.push({
                        from: gapFrom,
                        to: gapTo,
                        severity: 'error',
                        message: 'AtomBlockBoundaryError: RedundantLineBreak (多余的换行符，保存时将自动修正)',
                        source: 'boundary-linter'
                    });
                }
            }
        } else if (gapFrom === gapTo) {
            // No gap at all, missing newlines
            diagnostics.push({
                from: gapFrom,
                to: gapTo,
                severity: 'error',
                message: 'AtomBlockBoundaryError: MissingLineBreak (缺少换行符，应有两行空白，保存时将自动修正)',
                source: 'boundary-linter'
            });
        }
    }

    
    const currentErrorState = useWorkspaceStore.getState().fieldLintErrors[field];
    if (currentErrorState !== hasUnexpectedInterruption) {
        useWorkspaceStore.getState().setFieldLintError(field, hasUnexpectedInterruption);
    }

    return diagnostics;
});
