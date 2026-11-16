import { type DragEvent, useState } from 'react';

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Native drag-to-reorder for a list. Spread `rowProps(index)` on each row.
 * Rows should also offer move buttons, since dragging is not available to keyboard and many touch users.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function rowProps(index: number) {
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setDragIndex(index);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      },
      onDragOver: (event: DragEvent) => {
        if (dragIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        setOverIndex(index);
      },
      onDrop: (event: DragEvent) => {
        if (dragIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(dragIndex, index);
        setDragIndex(null);
        setOverIndex(null);
      },
      onDragEnd: () => {
        setDragIndex(null);
        setOverIndex(null);
      },
    };
  }

  return { rowProps, dragIndex, overIndex };
}
