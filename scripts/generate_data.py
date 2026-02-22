import json
import uuid
import hashlib
import re
from datetime import datetime

# --- Constants & Helpers ---

def generate_hash(content):
    return hashlib.md5(content.encode('utf-8')).hexdigest()

def generate_simhash(content):
    # Simplified simhash (just length + first char for mock) or just same hash
    # For now, let's just use md5 as simhash placeholder or implement basic
    return generate_hash(content)

def split_content(content, atom_type):
    if not content:
        return []

    if atom_type in ['inline', 'sources']:
        return [s.strip() for s in content.split('\n') if s.strip()]

    if atom_type in ['markdown', 'latex']:
        # Split by $$...$$ blocks or double newlines
        # Simple regex splitting
        parts = re.split(r'(\$\$[\s\S]*?\$\$)', content)
        atoms = []
        for part in parts:
            if not part.strip():
                continue
            if part.startswith('$$') and part.endswith('$$'):
                atoms.append(part.strip())
            else:
                # Split text by paragraphs
                paragraphs = re.split(r'\n\s*\n+', part)
                for p in paragraphs:
                    if p.strip():
                        atoms.append(p.strip())
        return atoms

    return [content]

# --- Main Logic ---

def main():
    try:
        with open('phys_memos_dataset (2).json', 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Input file not found.")
        return

    nodes = data.get('nodes', [])
    disciplines = data.get('disciplines', [])

    concepts = {}
    editions = {}
    atoms = {}

    # Store atom objects by ID to avoid duplicates if content matches?
    # Actually, for this generation, let's just create new atoms for simplicity unless identical content in same node.

    # 1. Process Nodes
    for node in nodes:
        node_id = node['id']
        title = node['title']
        topic = node.get('topic', 'Uncategorized')
        node_disciplines = node.get('disciplines', [])

        # Create Concept
        concept_id = node_id  # Reuse ID for easier mapping
        concept = {
            "id": concept_id,
            "name": title,
            "topic": topic,
            "disciplines": node_disciplines,
            "creatorId": "system",
            "createdAt": datetime.now().isoformat(),
            "currentHeads": {}, # Will populate after edition creation
            "frontMeta": {},
            "backMeta": {}
        }

        # Create Atoms
        atom_ids = {
            "doc": [], "core": [], "tags": [], "refs": [], "rels": []
        }

        # Helper to create atoms
        def create_atoms(content_str, field, atom_type):
            content_list = split_content(content_str, atom_type)
            ids = []
            for content in content_list:
                content_hash = generate_hash(content)
                atom_id = generate_hash(content + field + atom_type + title) # Unique per node context for now

                atom = {
                    "id": atom_id,
                    "field": field,
                    "type": atom_type,
                    "contentJson": content,
                    "contentHash": content_hash,
                    "contentSimHash": generate_simhash(content),
                    "creatorId": "system",
                    "createdAt": datetime.now().isoformat(),
                    "attr": {"system": 1},
                    "derivedFromId": None,
                    "frontMeta": {},
                    "backMeta": {}
                }
                atoms[atom_id] = atom
                ids.append(atom_id)
            return ids

        atom_ids['core'] = create_atoms(node.get('latex', ''), 'core', 'latex')
        atom_ids['doc'] = create_atoms(node.get('desc', ''), 'doc', 'markdown')
        # Constraints are list of strings
        constraints = node.get('constraints', [])
        atom_ids['tags'] = create_atoms('\n'.join(constraints), 'tags', 'inline')
        atom_ids['refs'] = create_atoms(node.get('references', ''), 'refs', 'sources')

        # Create Initial Edition
        edition_id = generate_hash(concept_id + "v1")
        edition = {
            "id": edition_id,
            "conceptId": concept_id,
            "saveType": "save",
            "coreAtomIds": atom_ids['core'],
            "docAtomIds": atom_ids['doc'],
            "tagsAtomIds": atom_ids['tags'],
            "refsAtomIds": atom_ids['refs'],
            "relsAtomIds": [], # Relations not fully atomized yet
            "creator": "system",
            "createdAt": datetime.now().isoformat(),
            "parentEditionId": None,
            "frontMeta": {},
            "backMeta": {}
        }

        editions[edition_id] = edition
        concept['currentHeads'][edition_id] = 1 # Initial sort order

        concepts[concept_id] = concept

    # 2. Add Branch Structure (Mock)
    # Pick the first concept
    if concepts:
        target_concept_id = list(concepts.keys())[0]
        target_concept = concepts[target_concept_id]
        original_head_id = list(target_concept['currentHeads'].keys())[0]
        original_head = editions[original_head_id]

        # Create a derived edition (v2) - Modifying doc
        # We need to copy atoms, modify one.
        # Let's add a new doc atom.

        new_doc_content = "This is a new note added in branch v2."
        new_atom_id = generate_hash(new_doc_content)
        new_atom = {
             "id": new_atom_id,
             "field": "doc",
             "type": "markdown",
             "contentJson": new_doc_content,
             "contentHash": generate_hash(new_doc_content),
             "contentSimHash": generate_hash(new_doc_content),
             "creatorId": "user_branch",
             "createdAt": datetime.now().isoformat(),
             "attr": {"user_branch": 1},
             "derivedFromId": None,
             "frontMeta": {},
             "backMeta": {}
        }
        atoms[new_atom_id] = new_atom

        # New Edition v2
        edition_v2_id = generate_hash(target_concept_id + "v2")
        edition_v2 = {
            "id": edition_v2_id,
            "conceptId": target_concept_id,
            "saveType": "save",
            "coreAtomIds": original_head['coreAtomIds'], # Unchanged
            "docAtomIds": original_head['docAtomIds'] + [new_atom_id], # Appended
            "tagsAtomIds": original_head['tagsAtomIds'],
            "refsAtomIds": original_head['refsAtomIds'],
            "relsAtomIds": [],
            "creator": "user_branch",
            "createdAt": datetime.now().isoformat(),
            "parentEditionId": original_head_id,
            "frontMeta": {},
            "backMeta": {}
        }
        editions[edition_v2_id] = edition_v2

        # Update heads: v2 replaces v1 if it's a linear update, or adds if branch?
        # Let's say it's a linear update for now.
        del target_concept['currentHeads'][original_head_id]
        target_concept['currentHeads'][edition_v2_id] = 2

        # Create a parallel branch (v3) from v1
        edition_v3_id = generate_hash(target_concept_id + "v3")

        # Modify core latex for v3
        new_latex_content = "$$ E = mc^2 + \\text{correction} $$"
        new_latex_atom_id = generate_hash(new_latex_content)
        new_latex_atom = {
             "id": new_latex_atom_id,
             "field": "core",
             "type": "latex",
             "contentJson": new_latex_content,
             "contentHash": generate_hash(new_latex_content),
             "contentSimHash": generate_hash(new_latex_content),
             "creatorId": "user_branch_2",
             "createdAt": datetime.now().isoformat(),
             "attr": {"user_branch_2": 1},
             "derivedFromId": None, # Ideally if we modified, we point to original. Here completely new.
             "frontMeta": {},
             "backMeta": {}
        }
        atoms[new_latex_atom_id] = new_latex_atom

        edition_v3 = {
            "id": edition_v3_id,
            "conceptId": target_concept_id,
            "saveType": "save",
            "coreAtomIds": [new_latex_atom_id], # Replaced
            "docAtomIds": original_head['docAtomIds'],
            "tagsAtomIds": original_head['tagsAtomIds'],
            "refsAtomIds": original_head['refsAtomIds'],
            "relsAtomIds": [],
            "creator": "user_branch_2",
            "createdAt": datetime.now().isoformat(),
            "parentEditionId": original_head_id,
            "frontMeta": {},
            "backMeta": {}
        }
        editions[edition_v3_id] = edition_v3

        # Add v3 as another head (Branching!)
        target_concept['currentHeads'][edition_v3_id] = 3

    # 3. Output
    output_data = {
        "disciplines": disciplines,
        "nodes": nodes, # Keep legacy nodes for now
        "attr_concepts": concepts,
        "attr_editions": editions,
        "attr_atoms": atoms
    }

    with open('public/default_data_v2.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print("Successfully generated public/default_data_v2.json")

if __name__ == "__main__":
    main()
