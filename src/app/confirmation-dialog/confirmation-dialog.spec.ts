import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { ConfirmationDialog } from './confirmation-dialog';

describe('ConfirmationDialog', () => {
  let component: ConfirmationDialog;
  let fixture: ComponentFixture<ConfirmationDialog>;
  const modal = { dismiss: vi.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    modal.dismiss.mockClear();
    await TestBed.configureTestingModule({
      imports: [ConfirmationDialog],
      providers: [provideTranslateService(), { provide: ModalController, useValue: modal }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  it('cancels when released early', () => {
    vi.useFakeTimers();
    component.onMouseDown(new MouseEvent('mousedown'));
    vi.advanceTimersByTime(1000);
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(modal.dismiss).toHaveBeenCalledWith(false);
  });

  it('confirms after holding for 5 seconds', () => {
    vi.useFakeTimers();
    component.onMouseDown(new MouseEvent('mousedown'));
    vi.advanceTimersByTime(5000);
    expect(modal.dismiss).toHaveBeenCalledWith(true);
  });
});
