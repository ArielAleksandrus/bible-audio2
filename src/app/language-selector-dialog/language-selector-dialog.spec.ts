import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LanguageSelectorDialog } from './language-selector-dialog';

describe('LanguageSelectorDialog', () => {
  let component: LanguageSelectorDialog;
  let fixture: ComponentFixture<LanguageSelectorDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LanguageSelectorDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
