import re

# Fix core.ts: error TS2345: Argument of type 'Blob | ArrayBuffer' is not assignable to parameter of type '(Blob | ArrayBuffer)[]'.
with open('src/attrstrand/utils.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sure generateBinaryHash is properly exported and takes single Blob|ArrayBuffer
# I already did this, maybe I need to check utils.ts again.
