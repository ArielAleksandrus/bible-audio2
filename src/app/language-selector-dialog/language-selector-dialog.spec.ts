import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';

import { LanguageSelectorDialog } from './language-selector-dialog';

describe('LanguageSelectorDialog', () => {
  let component: LanguageSelectorDialog;
  let fixture: ComponentFixture<LanguageSelectorDialog>;
  const modal = { dismiss: vi.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorDialog],
      providers: [{ provide: ModalController, useValue: modal }],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelectorDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('dismisses with the chosen language-version', () => {
    component.select('en', 'niv');
    expect(modal.dismiss).toHaveBeenCalledWith('en-niv', 'selected');
  });
});
