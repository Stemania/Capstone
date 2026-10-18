import { describe, expect, it } from 'vitest';
import { shopContactLines, shopLetterheadPreview } from './shopLetterheadPreview';

describe('shopLetterheadPreview', () => {
  it('updates contact lines and names from form values', () => {
    const preview = shopLetterheadPreview({
      shopName: 'Test Shop',
      tagline: 'Precision work',
      address: '1 Main St',
      telephone: '(043) 111',
      mobileNumbers: '0917',
      email: 'a@b.com',
      poApproverName: 'Greg',
      poApproverTitle: 'GM',
      joApproverName: 'Gary',
      joApproverTitle: 'Prod',
    });
    expect(preview.shopName).toBe('Test Shop');
    expect(preview.tagline).toBe('Precision work');
    expect(preview.address).toBe('1 Main St');
    expect(preview.contacts).toEqual([
      'Telephone no. (043) 111',
      'Mobile No: 0917',
      'Email add: a@b.com',
    ]);
    expect(preview.poApproverName).toBe('Greg');
    expect(preview.joApproverTitle).toBe('Prod');
  });

  it('rebuilds when a field changes (live preview)', () => {
    const before = shopLetterheadPreview({ shopName: 'A', telephone: '1' });
    const after = shopLetterheadPreview({ shopName: 'B', telephone: '2' });
    expect(before.shopName).toBe('A');
    expect(after.shopName).toBe('B');
    expect(shopContactLines({ telephone: '2' })).toEqual(['Telephone no. 2']);
  });
});
