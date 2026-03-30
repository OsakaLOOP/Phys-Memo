import re

with open('src/components/AttrStrand/Editor/ImageGroupViewer.tsx', 'r') as f:
    content = f.read()

# Let's see if the file actually contains the double caption
print("Captions Row: Top Aligned" in content)
