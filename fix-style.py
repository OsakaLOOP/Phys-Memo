import re

with open("src/components/AttrStrand/AtomBlock.tsx", "r") as f:
    content = f.read()

# Replace the specific tag input block
search_editor = """        if (atom.field === 'tags') {
             return (
                 <input
                    type="text"
                    className="w-full p-1 text-sm input-bordered border-indigo-500 rounded"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="标签..."
                 />
             );
        }"""

replace_editor = """        if (atom.field === 'tags') {
             return (
                 <input
                    type="text"
                    className="
                        p-1 pl-2 pr-[3.5rem] text-sm font-medium rounded-lg outline-none
                        bg-[#f8fafc] border border-indigo-300 text-slate-700
                        shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#e0e7ff]
                        focus:bg-white focus:border-indigo-400 focus:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1),_0_0_0_2px_#c7d2fe]
                        transition-all z-50 absolute left-0 top-1/2 -translate-y-1/2
                    "
                    style={{
                        width: `max(200px, calc(${editValue.length}ch + 4rem))`,
                        maxWidth: '400px'
                    }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="标签..."
                 />
             );
        }"""

content = content.replace(search_editor, replace_editor)

# We need to make sure the relative container for the tag has enough height so the absolute input doesn't collapse it.
# We also want to vertically center the buttons.
search_render = """            {isEditing ? (
                <div className="relative min-w-[200px]">
                    {renderEditor()}
                    <div className="absolute top-1 right-1 flex gap-1 z-10">
                        <button
                            onClick={handleSave}
                            className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="保存 (Enter / Ctrl+Enter)"
                        >
                            <Check size={12} />
                        </button>
                        <button
                            onClick={handleCancel}
                            className="btn-danger bg-red-100"
                            title="取消 (Esc)"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            ) :"""

replace_render = """            {isEditing ? (
                <div className={`relative min-w-[200px] ${atom.field === 'tags' ? 'h-[32px] z-50' : ''}`}>
                    {renderEditor()}
                    <div className={`absolute flex gap-1 z-[60] ${atom.field === 'tags' ? 'top-1/2 -translate-y-1/2' : 'top-1'} right-1`}
                         style={atom.field === 'tags' ? { left: `calc(max(200px, calc(${editValue.length}ch + 4rem)) - 3.25rem)`, width: '3rem' } : undefined}
                    >
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                            onClick={handleSave}
                            className={`p-1 rounded transition-colors flex items-center justify-center w-5 h-5 ${atom.field === 'tags' ? 'bg-green-100/90 text-green-600 hover:bg-green-200 shadow-sm' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                            title="保存 (Enter / Ctrl+Enter)"
                        >
                            <Check size={12} strokeWidth={atom.field === 'tags' ? 2.5 : 2} />
                        </button>
                        <button
                            onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
                            onClick={handleCancel}
                            className={`p-1 rounded transition-colors flex items-center justify-center w-5 h-5 ${atom.field === 'tags' ? 'bg-red-100/90 text-red-500 hover:bg-red-200 shadow-sm' : 'btn-danger bg-red-100'}`}
                            title="取消 (Esc)"
                        >
                            <X size={12} strokeWidth={atom.field === 'tags' ? 2.5 : 2} />
                        </button>
                    </div>
                </div>
            ) :"""

content = content.replace(search_render, replace_render)

with open("src/components/AttrStrand/AtomBlock.tsx", "w") as f:
    f.write(content)
