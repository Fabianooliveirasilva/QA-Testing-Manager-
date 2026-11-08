import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';
import { Pagination } from './page';
import { ResultBadge, SeverityBadge } from './status-badge';

describe('status badges', () => {
  it('render human-readable labels', () => {
    render(
      <>
        <ResultBadge status="NOT_RUN" />
        <SeverityBadge severity="CRITICAL" />
      </>,
    );
    expect(screen.getByText('Not run')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('is hidden for a single page and navigates otherwise', async () => {
    const onPage = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={20} total={5} onPage={onPage} />);
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
    rerender(<Pagination page={1} pageSize={20} total={45} onPage={onPage} />);
    expect(screen.getByText('1–20 of 45')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Next page'));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('ConfirmDialog', () => {
  it('only runs the destructive action after explicit confirmation', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog trigger={<button>Delete item</button>} title="Delete?" description="Gone forever" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText('Delete item'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Delete item'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
