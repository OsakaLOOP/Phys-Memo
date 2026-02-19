import { type FC } from 'react';
import EditableBlock, { type EditableBlockProps } from './EditableBlock';

const SmartFormulaBlock: FC<EditableBlockProps> = (props) => {
  return (
    <EditableBlock
      {...props}
      enableAnalysis={true}
    />
  );
};

export default SmartFormulaBlock;
