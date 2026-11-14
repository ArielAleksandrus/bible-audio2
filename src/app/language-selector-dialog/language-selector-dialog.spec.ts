import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';

import { LanguageSelectorDialog } from './language-selector-dialog';
import { BUNDLED_CATALOG, resetCatalog, setCatalog } from '../data/bible-catalog';

describe('LanguageSelectorDialog', () => {
  let component: LanguageSelectorDialog;
  let fixture: ComponentFixture<LanguageSelectorDialog>;
  const modal = { dismiss: vi.fn().mockResolvedValue(true) };
  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB' };

  async function open() {
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorDialog],
      providers: [{ provide: ModalController, useValue: modal }],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelectorDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  beforeEach(() => { modal.dismiss.mockClear(); resetCatalog(); });
  afterEach(() => resetCatalog());

  it('lists languages by name and picks the only version by itself', async () => {
    await open();
    expect(component.options.map(o => o.name)).toEqual(['Português', 'English', 'Español', '中文', '日本語']);
    component.chooseLanguage(component.options[1]);
    expect(modal.dismiss).toHaveBeenCalledWith('en-niv', 'selected');
  });

  it('asks for the version when the language has two, and dismisses only after that choice', async () => {
    setCatalog([...BUNDLED_CATALOG, otb]);
    await open();
    component.chooseLanguage(component.options[0]);
    expect(modal.dismiss).not.toHaveBeenCalled();
    expect(component.language?.versions.map(v => v.version)).toEqual(['ara', 'otb']);
    component.select(component.language!.versions[1]);
    expect(modal.dismiss).toHaveBeenCalledWith('pt-otb', 'selected');
  });

  it('does not ask when the other versions of the language are hidden', async () => {
    setCatalog([{ ...BUNDLED_CATALOG[0], hidden: true }, otb, ...BUNDLED_CATALOG.slice(1)]);
    await open();
    component.chooseLanguage(component.options[0]);
    expect(modal.dismiss).toHaveBeenCalledWith('pt-otb', 'selected');
  });
});
