import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { Subject } from 'rxjs';

import { LanguageSelectorDialog } from './language-selector-dialog';
import { resetCatalog, setCatalog } from '../data/bible-catalog';
import { CatalogService } from '../services/catalog.service';
import { FIVE_LICENSED } from '../../testing/bible-catalog';

describe('LanguageSelectorDialog', () => {
  let component: LanguageSelectorDialog;
  let fixture: ComponentFixture<LanguageSelectorDialog>;
  const modal = { dismiss: vi.fn().mockResolvedValue(true) };
  const changed$ = new Subject<void>();
  const otb = { lang: 'pt', version: 'otb', flag: '🇧🇷', label: 'Português - OTB' };
  let resolveReady: () => void;
  let ready: Promise<void>;

  function armReady() {
    ready = new Promise<void>(resolve => { resolveReady = resolve; });
  }

  async function open() {
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorDialog],
      providers: [
        { provide: ModalController, useValue: modal },
        { provide: CatalogService, useValue: { whenReady: () => ready, changed$ } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelectorDialog);
    component = fixture.componentInstance;
    resolveReady();
    await fixture.whenStable();
  }

  beforeEach(() => { modal.dismiss.mockClear(); resetCatalog(); setCatalog(FIVE_LICENSED); armReady(); });
  afterEach(() => resetCatalog());

  it('hides the bundled list until the catalog check finishes', async () => {
    resetCatalog();
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorDialog],
      providers: [
        { provide: ModalController, useValue: modal },
        { provide: CatalogService, useValue: { whenReady: () => ready, changed$ } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LanguageSelectorDialog);
    component = fixture.componentInstance;
    expect(component.waiting).toBe(true);
    expect(component.options).toEqual([]);

    setCatalog(FIVE_LICENSED);
    resolveReady();
    await fixture.whenStable();
    expect(component.waiting).toBe(false);
    expect(component.options.map(o => o.name)).toEqual(['Português', 'English', 'Español', '中文', '日本語']);
  });

  it('replaces the list when the catalog changes while the dialog is open', async () => {
    await open();
    setCatalog([...FIVE_LICENSED, otb]);
    changed$.next();
    expect(component.options[0].versions.map(v => v.version)).toEqual(['ara', 'otb']);
  });

  it('lists languages by name and picks the only version by itself', async () => {
    await open();
    expect(component.options.map(o => o.name)).toEqual(['Português', 'English', 'Español', '中文', '日本語']);
    component.chooseLanguage(component.options[1]);
    expect(modal.dismiss).toHaveBeenCalledWith('en-niv', 'selected');
  });

  it('asks for the version when the language has two, and dismisses only after that choice', async () => {
    setCatalog([...FIVE_LICENSED, otb]);
    await open();
    component.chooseLanguage(component.options[0]);
    expect(modal.dismiss).not.toHaveBeenCalled();
    expect(component.language?.versions.map(v => v.version)).toEqual(['ara', 'otb']);
    component.select(component.language!.versions[1]);
    expect(modal.dismiss).toHaveBeenCalledWith('pt-otb', 'selected');
  });

  it('does not ask when the other versions of the language are hidden', async () => {
    setCatalog([{ ...FIVE_LICENSED[0], hidden: true }, otb, ...FIVE_LICENSED.slice(1)]);
    await open();
    component.chooseLanguage(component.options[0]);
    expect(modal.dismiss).toHaveBeenCalledWith('pt-otb', 'selected');
  });
});
