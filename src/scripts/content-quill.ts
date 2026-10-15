// Only the formats used by our editor are registered. In particular, do not
// import quill's full entry point: formula/video HTML export is affected by
// CVE-2025-15056 and those embeds are not part of our content contract.
import Quill from 'quill/core';
import {AlignClass,AlignStyle} from 'quill/formats/align';
import Blockquote from 'quill/formats/blockquote';
import Bold from 'quill/formats/bold';
import Header from 'quill/formats/header';
import Image from 'quill/formats/image';
import Italic from 'quill/formats/italic';
import Link from 'quill/formats/link';
import List from 'quill/formats/list';
import Strike from 'quill/formats/strike';
import Underline from 'quill/formats/underline';
import Toolbar from 'quill/modules/toolbar';
import SnowTheme from 'quill/themes/snow';

Quill.register({
 'attributors/class/align':AlignClass,'attributors/style/align':AlignStyle,
 'formats/align':AlignClass,'formats/blockquote':Blockquote,'formats/bold':Bold,
 'formats/header':Header,'formats/image':Image,'formats/italic':Italic,
 'formats/link':Link,'formats/list':List,'formats/strike':Strike,
 'formats/underline':Underline,'modules/toolbar':Toolbar,'themes/snow':SnowTheme,
},true);

export default Quill;
