import React from 'react';
import { WinningNumbers } from '../types';
import { Save, Plus, Trash2 } from 'lucide-react';

interface Props {
  numbers: WinningNumbers;
  onSave: (newNumbers: WinningNumbers) => void;
  onCancel: () => void;
}

const NumberSettings: React.FC<Props> = ({ numbers, onSave, onCancel }) => {
  const [formData, setFormData] = React.useState<WinningNumbers>(numbers);

  const handleChange = (field: keyof WinningNumbers, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleArrayChange = (
    field: 'firstPrize' | 'additionalSixthPrize',
    index: number,
    value: string
  ) => {
    const newArray = [...formData[field]];
    newArray[index] = value;
    setFormData({ ...formData, [field]: newArray });
  };

  const addArrayItem = (field: 'firstPrize' | 'additionalSixthPrize') => {
    setFormData({ ...formData, [field]: [...formData[field], ""] });
  };

  const removeArrayItem = (field: 'firstPrize' | 'additionalSixthPrize', index: number) => {
    const newArray = [...formData[field]];
    newArray.splice(index, 1);
    setFormData({ ...formData, [field]: newArray });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-2xl mx-auto my-4 border-t-4 border-primary">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">設定開獎號碼</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Period */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">期別 (Period)</label>
          <input
            type="text"
            required
            value={formData.period}
            onChange={(e) => handleChange('period', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            placeholder="e.g. 113年 09-10月"
          />
        </div>

        {/* Special Prize */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <label className="block text-sm font-bold text-gray-800 mb-1">特別獎 (1000萬)</label>
          <input
            type="text"
            maxLength={8}
            value={formData.specialPrize}
            onChange={(e) => handleChange('specialPrize', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md font-mono text-lg tracking-widest focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="8位數號碼"
          />
        </div>

        {/* Grand Prize */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <label className="block text-sm font-bold text-gray-800 mb-1">特獎 (200萬)</label>
          <input
            type="text"
            maxLength={8}
            value={formData.grandPrize}
            onChange={(e) => handleChange('grandPrize', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md font-mono text-lg tracking-widest focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="8位數號碼"
          />
        </div>

        {/* First Prize List */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-bold text-gray-800">頭獎 (20萬起)</label>
            <button type="button" onClick={() => addArrayItem('firstPrize')} className="text-primary hover:text-primary-dark flex items-center text-xs bg-white border border-primary px-2 py-1 rounded">
              <Plus size={14} className="mr-1"/> 新增
            </button>
          </div>
          <div className="space-y-2">
            {formData.firstPrize.map((num, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  maxLength={8}
                  value={num}
                  onChange={(e) => handleArrayChange('firstPrize', idx, e.target.value)}
                  className="flex-1 p-2 border border-gray-300 rounded-md font-mono text-lg tracking-widest focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="8位數號碼"
                />
                <button type="button" onClick={() => removeArrayItem('firstPrize', idx)} className="text-gray-400 hover:text-red-600 p-2">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Additional Sixth Prize */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-bold text-gray-800">增開六獎 (200元)</label>
            <button type="button" onClick={() => addArrayItem('additionalSixthPrize')} className="text-primary hover:text-primary-dark flex items-center text-xs bg-white border border-primary px-2 py-1 rounded">
              <Plus size={14} className="mr-1"/> 新增
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {formData.additionalSixthPrize.map((num, idx) => (
              <div key={idx} className="flex gap-2 relative">
                <input
                  type="text"
                  maxLength={3}
                  value={num}
                  onChange={(e) => handleArrayChange('additionalSixthPrize', idx, e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md font-mono text-lg tracking-widest text-center focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="3碼"
                />
                <button type="button" onClick={() => removeArrayItem('additionalSixthPrize', idx)} className="absolute right-2 top-2 text-gray-400 hover:text-red-500">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onCancel} className="px-6 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            取消
          </button>
          <button type="submit" className="px-6 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark flex items-center shadow-md">
            <Save size={18} className="mr-2" /> 儲存設定
          </button>
        </div>
      </form>
    </div>
  );
};

export default NumberSettings;