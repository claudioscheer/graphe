# **MyBible Modules Format**

Revision 2025-06-15

Link to the document: https://docs.google.com/document/d/12rf4Pqy13qhnAW31uKkaWNTBDTtRbNW0s7cM0vcimlA/edit

# **History of Changes**

Revision 2025-06-15

* Corrected the semantics description of the \<J\> tag \- it is actually applicable also to the Old Testament.

Revision 2024-09-10

* Added the “left\_guillemet\_on\_the\_right” parameter for Bible modules.

Revision 2024-05-10

* Described the “right\_to\_left” parameter for subheading modules (it is long supported but was not documented).

Revision 2023-01-26 \- corresponds to **MyBible 5.6.0**

* The subsections at the beginning "INFO Table", "CONTENT\_FRAGMENTS Table", "HTML Content" moved inside the "General" section (for a cleaner document structure).  
* In the "Dictionary Module" section:  
  * In the INFO table, removed mentioning of the is\_word\_forms parameter, as no longer supported by the app.  
  * In the DICTIONARY table description added a paragraph describing that this table is optional and what will happen if it is absent.

Revision 2021-07-31 \- corresponds to **MyBible 5.3.2**

* Corrections to the "Books reference" table  
  * Book number for "Молитва Манассии" changed from 790 to 145\.  
  * Added English abbreviations and names to non-canonical books listed in the table.  
  * Added several more non-canonical books, which are used in some non-Russian Bibles.

Revision 2021-06-10

* For Bible modules added parameters:  
  * book\_list\_right\_to\_left  
  * book\_list\_right\_to\_left\_ot  
  * book\_list\_right\_to\_left\_nt

Revision 2021-05-30

* For Bible modules added support of decoding morphology specific to this particular Bible module:  
  * Added the MORPHOLOGY\_INDICATIONS table.  
  * Added the MORPHOLOGY\_TOPICS table.  
  * Added the "morphology\_topic\_reference\*" configuration parameters description.  
* For a dictionary module (clarifications related to morphology):  
  * Recorded a (so far implicit) needed condition for the actual usage of the MORPHOLOGY\_TOPICS table.  
  * Added an example for the "morphology\_topic\_reference" configuration parameter.

Revision 2019-07-20 \- corresponds to **MyBible 5.0.0**

* To the "HTML Content" section added support for external hyperlinks.

Revision 2018-10-15 \- corresponds to **MyBible 4.8.0-4.8.9**

* To the "HTML Content" section added an explanation on how to refer to particular fonts.

Revision 2018-08-01

* Updated the format of references to fragments (INCLUDE).

Revision 2018-07-08

* For dictionary modules added the "default\_topic" parameter.

Revision 2018-07-02

* In an HTML content, allowed references to fragments from other modules.

Revision 2018-06-17

* For a dictionary lookup, introduced the Normalized Form 0 (NF0) to replace the exact topic search for concordance dictionaries.

Revision 2018-06-02

* Changes for MyBible 4.8 regarding footnote commentary modules.  
* Description of HTML content is generalized and moved from separate modules to the new section "HTML Content".  
* Added the optional table CONTENT\_FRAGMENTS and allowed references from HTML content to fragments from this table.  
* Added an optional table "books" for commentaries modules.

Revision 2018-04-22

* "Bible translation" term is replaced with "Bible module" throughout the document.  
* For a Bible module added a parameter for an associated theme.

Revision 2018-03-08

* Added description of bundling different modules and other resources in a single .zip file \- to be supported starting MyBible 4.8.0.  
* Listed the ZIP archiving applications known to support acceptable archives.

Revision 2018-02-17

* Added support of the tags \<h\> … \</h\> in Bible modules.

Revision 2018-01-31 \- corresponds to **MyBible 4.7.2-4.7.7**

* Added the "title" field in the BOOKS\_ALL table of Bible modules.

Revision 2018-01-21 \- corresponds to **MyBible 4.7.0, 4.7.1**

* Added the "origin" and "history\_of\_changes" configuration parameters, to better keep track of module changes.  
* In Bible commentary modules added the "add\_space\_before\_footnote\_marker" parameter.

Revision 2017-12-09

* In dictionary modules, updated the structure of the WORDS table: removed indexes (added a note) and extended semantics of the "variation" field.  
* Corrected forming of the hash fields in the LOOKUP\_WORDS table, for correct matching by EXACT comparison.

Revision 2017-11-30

* Added support for several custom HTML classes in the value of html\_style, see the description of the INFO table.

Revision 2017-10-27

* Added an optional field is\_preceding for commentary modules.

Revision 2017-10-14

* Added support of synonymous Strong's numbers in Strong's lexicon modules.

Revision 2017-09-04

* Corrected the dictionary lookup algorithm, so that the NF2 is used more correctly \- important for treating accents in dictionaries that are non-Greek and non-Hebrew (e.g. French).

Revision 2017-08-02

* From the INFO table of a Bible module removed the parameters swaps\_non\_localized\_words\_in\_mixed\_language\_line and localized\_book\_abbreviations, as no longer needed after the Arabic improvements in the build 4.6.2.

Revision 2017-07-23 \- corresponds to **MyBible 4.6.6**

* The color of footnotes marker in the Bible text, defined in the application, can now be used in the commentaries module, see the added COLOR\_FOOTNOTE\_MARKER color in the commentaries module description.  
* In the BOOKS table of a Bible module added a "sorting\_order" field for custom sorting of book in a module.

Revision 2017-02-21 \- corresponds to **MyBible 4.6.1**

* Correction to the Dictionary Lookup Algorithm: in case if more than one topic is found for a word                in the current dictionary, shown the list of applicable topics only from the current dictionary. Otherwise, shows the list of applicable topics from all the dictionaries.

Revision 2017-02-07 \- corresponds to **MyBible 4.6.0**

* Dictionary Lookup Algorithm is corrected/simplified.

Revision 2017-01-17

* Extended the section "Dictionary Lookup Data Generation" with copying of still applicable records from the LOOKUP\_REFERENCES table.

Revision 2016-12-17

* Corrected Dictionary Lookup Algorithm for a somewhat faster lookup of a Strong's number (searching for a Strong's number for a current place is now issued after searching simply by a Strong's number, which is more likely to yield a desired single result).

Revision 2016-11-28

* Changes made to dictionary tables for a better lookup support.  
* The “Dictionary Search Algorithm” is captured to be used starting MyBible 4.5.2 \- see the “Dictionary module” section.  
* Added another way to reference text coloring options for dictionaries, commentaries, devotions \- special keywords instead of color indexes.  
* Added the “html\_style” item for the INFO table \- common for dictionaries, commentaries, devotions.  
* Added the “chapter\_string\_ps” item for the INFO table for Bible modules.  
* Added support of cognate Strong numbers displaying:  
  * Added the COGNATE\_STRONG\_NUMBERS table in the Dictionary Module section  
  * Added the “cognate\_strong\_numbers\_info” item for the INFO table for Dictionary modules.  
* Added the “informative\_references\_to\_verses” item for the INFO table for dictionary modules.  
* Description of the “hyperlink\_languages” parameter is updated to make it applicable to Bible modules, too.  
* Added fields to the DICTIONARY table:  
  * lexeme  
  * transliteration  
  * pronunciation  
  * short\_definition

Revision 2016-04-25 \- corresponds to **MyBible 4.5.1**

* Added support of hyperlinks to dictionary topics and Strong’s lexicon topics from commentaries.

Revision 2016-04-12

* Added the “History of Changes” with updates since MyBible 4.4.2 release.

Revision 2016-03-26 \- corresponds to **MyBible 4.5.0**

* In the “General” section, reorganized a description of module files and added a description of zipped modules format, which is supported in MyBible 4.5.0.

Revision 2016-01-09

* Added a description of hyperlinks supported in the INTRODUCTIONS table of a Bible module.

Revision 2015-12-04

* Updated description of subheadings support:  
  * SUBHEADINGS table of a Subheadings module  
  * STORIES table of a Bible module

Revision 2015-11-13

* Updated description of a Bible module in part of the BOOKS\_ALL table and is\_present column of the BOOKS table.

Revision 2015-11-06

* Updated description of a Cross References module.  
* Updated description of a Dictionary module in part of the WORDS table index.

Revision 2015-10-13

* Description of the russian\_numbering fields moved from modules to the General section.  
* Cross Reference Set module:  
  * Added a support of multi-language descriptions.  
  * Updated a description of the CROSS\_REFERENCES table.

Revision 2015-09-15 \- corresponds to **MyBible 4.4.2**

# 

# **General**

[MyBible Android application](https://play.google.com/store/apps/details?id=ua.mybible) has downloadable modules which are SQLite databases, containing several tables and indexes for them.

On a PC, MyBible modules can be opened and edited using freely available SQLite browsers, e.g.:

* [SQLite Database Browser from sourceforge.net](http://sourceforge.net/projects/sqlitebrowser/files/?source=navbar)  
* [SQLite Manager plugin for Firefox](https://addons.mozilla.org/ru/firefox/addon/sqlite-manager/)

## **Module Files**

File names of all the MyBible downloadable modules have the following format:

\<module abbreviation\>\<.module type suffix\>.SQLite3

Module abbreviations may contain national characters (Russian, Chinese, etc.). A module abbreviation is defined only by the module file name (i.e. there is no module abbreviation information within a module).

## **Zipped Module Files**

*Note: information in this section is important solely for MyBible team members, because MyBible handles zipped modules only in the process of their downloading.*

For a more efficient downloading, MyBible modules are stored in the MyBible modules repository in a zipped format.

### **Zipping of Related Modules (MyBible version before 4.8.0)**

Zipping of modules provides for bundling of different module types having the same abbreviation, so that, for example, a Bible module can be downloaded together with a commentaries module for it, which contains footnotes.

Before MyBible 4.8.0, national characters in file names within a ZIP were not supported. Due to that, and also to provide for a zipped module type recognizing without a need of going within a ZIP, the following convention of a ZIP file name and file names within it was used.

**ZIP file itself:**

	\<module abbreviation\>\<.module type suffix\>.zip

**Files within a ZIP file:**

	.SQLite3 (this is for a single or for the main module in a ZIP)

\<.module type suffix\>.SQLite3 (this is for additional modules in a ZIP).

Example 1: the “РСП” modern Russian Bible translation, with commentaries module carrying footnotes for it:

РСП.zip

.SQLite3

.commentaries.SQLite3

Example 2: a big dictionary module CBTEL, zipped for downloading efficiency:

CBTEL.dictionary.zip

.SQLite3

### **Bundling of Different Materials Within a ZIP**

Starting MyBible 4.8.0, there is no longer a limitation on file names within a ZIP.

**Some ZIP archiver applications do not ensure the required by MyBible UTF-8 encodings of file names within a ZIP. Here are the archivers that are known to produce ZIP archives acceptable for MyBible:**

- **WinZIP**  
- **WinRAR**  
- **Bandizip**

For backward compatibility, the approach to naming of ZIP module files for MyBible 4.8.0 and later is the same as it was before:

\<module abbreviation\>\<.module type suffix\>.zip

However, an additional module type suffix is introduced starting MyBible 4.8.0:

	.bundle

A downloadable zipped bundle internally contains a structure of subdirectories and files similar to how files are stored in the MyBible data directory.

Example:

	Aramaic.bundle.zip

		PeshNT-en.SQLite3

		PST.SQLite3

		Aramaic.dictionary.SQLite3

		Aramaic-en.dictionary.SQLite3

		user\\

			bookmarks\\

				places\_in\_aramaic.mbb.json

			fonts\\

				Aramaic.ttf

			notes\\

				Overviews\\

					Aramaic Bible translations overview.txt

			themes\\

				Aramaic large.theme.json

				Aramaic light.theme.json

## **Module Types**

There are several types of MyBible downloadable modules.

1) **Bible modules**  
   Module type suffix: none  
   Examples: KJV+.SQLite3, RST.SQLite3.

2) **Dictionary modules**  
   Module type suffix: “.dictionary”  
   Examples: Strong.dictionary.SQLite3, Лексикон.dictionary.SQLite3, Брокгауз.dictionary.SQLite3

3) **Subheadings modules**  
   Module type suffix: “.subheadings”  
   Example: KJV-s.subheadings.SQLite3

4) **Cross references modules**  
   Module type suffix: “.crossreferences”  
   Example: OBX.crossreferences.SQLite3

5) **Commentaries modules**  
   Module type suffix: “.commentaries”  
   Example: RCAS.commentaries.SQLite3

6) **Reading plan modules**  
   Module type suffix: “.plan”  
   Example: AGV-p.plan.SQLite3

7) **Daily devotions modules**  
   Module type suffix: “.devotions”  
   Example: DCF-d.devotions.SQLite3, Шатр-ч.devotions.SQLite3

8) **Bundle modules**  
   This is a collection of modules, related appearance materials (fonts, themes), bookmarks, possibly some additional materials.  
   Module type suffix: ".bundle"  
   Example: Aramaic.bundle.zip.

## **INFO Table**

The info table is present in all MyBible modules. This table contains configuration parameters describing a module, as name-value pairs.

CREATE TABLE info (name TEXT, value TEXT)

Here are the **common configuration parameters** (existing for all the modules).

| Item name | Description |
| :---- | :---- |
| origin | Information on the module origin:: a name and email of a person who has created or updated the module an origin of a module's texts, as precise as possible, including a link publishing permission information, if exists additional relevant information Example: *2016-01-14* Created by Oleg Safonov, [mybible.modules@gmail.com](mailto:mybible.modules@gmail.com). The text is taken from the Open Bible project: https://openbibleproject.org. Public domain, no known copyrights on this text.  |
| history\_of\_changes | Information on history of changes, latest changes first. Shall include: date of changes publishing author of changes, if different from the person in the "origin" parameter summary of changes, along with a rationale of making them. Example: *2016-01-14 Updated the "detailed\_info" parameter with more precise information. Added missing spaces in Psalm 12:4. 2015-06-28 Changed by Denys Dolganenko, [mybibledev@gmail.com](mailto:mybibledev@gmail.com). Updated the "font\_scale" parameter to be 1.0 (was 0.9 due to a previous mistake).* |
| language | A language code the module is associated with. Shall be a two-letter Java locale code, e.g. “en” for English, “ru” for Russian, “zh” for Chinese, etc. If the language doesn’t have a two-letter code and has only a three-letter code, the value of this parameters depends on the version of ISO 639 standard: If the code has been assigned by ISO 639-2 standard, set the "language" parameter to the three-letter code and don’t set the "region" parameter; If the code has been assigned by ISO 639-3 standard, set the "language" parameter to the English name of the language as defined by the standard and set a value of the "region" parameter. If the language has several writing systems it could be set (in English) after the code, for example: “zh Simplified”, “uz Cyrillic” |
| description | A module description, as it shall appear in the list of modules. A module description is either an official title, as it is specified on the cover of a printed version, or a commonly accepted recognizable identification. For Bible modules, the word "Bible" can be omitted in the description, because it is clear from the modules group where it belongs. This text contains plain text (no formatting tags). |
| detailed\_info | Provides detailed information about a module text, as it is (or would be) specified on the first page of a printed version, including the year of the original edition. Also provides (at the end) additional information about a module's features in the MyBible context. This text can contain HTML formatting tags. Note: When placing this text to the modules catalog (downloads.xml file), \< and \> for HTML tags shall be specified as \&lt; and \&gt; respectively. *Examples:     \<h2\>Библия\</h2\> \<h3\>Новый русский перевод\</h3\> International Bible Society / BIBLICA, 2010\<p/\> Форматированный текст, с выделением слов Иисуса, со сносками.     \<h2\>Holy Bible\</h2\> \<h3\>New American Standard Bible\</h3\> Lockman Foundation, 1995\<p/\>With Strong's Numbers, Formatted, Red Letter edition.     \<h2\>NET Bible\</h2\> \<h3\>New English Translation\</h3\> Biblical Studies Press, 2005\<p/\> Formatted text, Red Letter edition, with footnotes.* |
| region | A region where this language is used, in English (e.g. “Micronesia”) \- see the "language" parameter description above for when this value is assigned. |
| russian\_numbering | An indication that a module references Bible verses using “Russian translation numbering” for the books of Psalms, Song of Solomon, Job. Can be “true” or “false”, default is “false”. |
| hyperlink\_languages | Languages (additional to the “language” parameter), in which a module text contains hyperlinks to dictionary topics \- this is desired for MyBible to more effectively support dictionary hyperlinks in several languages. This parameter can be used for Bible modules, dictionary modules, for commentary modules, and for devotion modules (i.e. for modules that contain HTML with hyperlinks). This field can list several language codes, separated by “/”. *For example, a Russian Strong Lexicon module can contain hyperlinks to Greek, Hebrew, and English words. The “hyperlink\_languages” parameter value shall then be set to “el/iw/en”.* |
| html\_style | HTML information that is to be placed within the \<style\> … \</style\> tags of a module containing HTML content (dictionaries, commentaries, devotions). The \<style\> … \</style\> tags themselves are created by MyBIble automatically, with some required initial style information between them. So additional style information specified by this parameter can look like this: *a{text-decoration:none;}div{margin-top:0px;margin-bottom:3px;}* There are the following HTML classes that MyBible generates, allowing a module creator more control on the appearance of special elements in the HTML content: \<p class='footnote\_header'\>...\</p\> \- this class allows to redefine an appearance of a footnote header (containing a footnote marker). \<p class='break\_between\_articles'/\> \- this class allows to redefine the spacing or other formatting aspects regarding the spacing between different articles or footnotes that are shown one after another in a single window. Example for both classes specified above: *\<font color=\#000000 face='Tahoma'\> \<p class='footnote\_header'\>\<b\>\<small\>2:6 \<sup\>\[7\]\</sup\>\</small\>\</b\> ...\</p\> \<p class='break\_between\_articles'/\> \<p class='footnote\_header'\>\<b\>\<small\>2:7 \<sup\>\[8\]\</sup\>\</small\>\</b\> ...\</p\> \<p class='break\_between\_articles'/\> \<p class='footnote\_header'\>\<b\>\<small\>2:7 \<sup\>\[9\]\</sup\>\</small\>\</b\> ....\</p\> \</font\>*  \<p class='commentary\_header'\>...\</p\> \- this class allows to redefine an appearance of a commentary header (containing a relevant Bible position) in the Commentaries window. Example of this class usage for a commentary header : *\<font color=\#000000 face='Tahoma'\> \<p class='commentary\_header'\>\<b\>\<a class='commentary\_header' href='B:10 1:1'\>Gen 1:1\</a\>\</b\>\</p\> … \</font\>*  \<p class='commentary\_popup\_header'\>...\</p\> \- this class allows to redefine an appearance of a commentary header (containing a relevant Bible position) in the popup or a header of a footnote from another module (containing a relevant Bible position and a footnote marker) in the popup. Example of this class usage in a commentary popup header : *\<font color=\#000000 face='Tahoma'\> \<table class='commentary\_popup\_header' width='100%' cellpadding='0' rulers='none'\>    \<tr\>     \<td align='left'\>       \<p class='commentary\_popup\_header'\>\<b\>\<a class='commentary\_popup\_header' href='B:500 1:2'\>Ин 1:2\</a\>\</b\>\</p\>     \</td\>     \<td align='right'\>       \<b\>Лоп-к\</b\>     \</td\>   \</tr\> \</table\> \<p/\> ... \</font\>*  There is also a possibility to use named colors from the current MyBible theme in this style information. MyBible will replace the following keywords with corresponding colors from the MyBible theme: %COLOR\_TEXT% \- default text color %COLOR\_RED% \- text color 1 %COLOR\_GREEN% \- text color 2 %COLOR\_BLUE% \- text color 3 %COLOR\_PURPLE% \- text color 4 %COLOR\_GREY% \- text color 5 Example: *\<style\> h1 { color: %COLOR\_RED% } \</style\>* |

Note that a module abbreviation is defined by the module file name and is not repeated in the INFO table.

# 

## **CONTENT\_FRAGMENTS Table**

The content\_fragments is an optional table that can be present in a module that carries HTML content \- see the "HTML Content" section below.

CREATE TABLE content\_fragments (id TEXT, fragment TEXT)

CREATE UNIQUE INDEX content\_fragments\_index ON content\_fragments (id)

| Item name | Description |
| :---- | :---- |
| id | Fragment ID. Can contain any characters except for parentheses. |
| fragment | HTML content fragment to be identified by its ID and inserted to an appropriately marked place in an overall HTML content article (see the "HTML Content" section below). MyBible does not interpret fragments by themselves \- it only interprets the overall HTML content after all the referenced fragments are inserted into their places. |

# 

## **HTML Content**

Several types of MyBible modules carry HTML content: dictionary modules, commentary modules, devotion modules. There are the following special features about the HTML content provided in those modules.

1) An HTML content is specified without the \<html\> and \<body\> tags.

2) MyBible supports references to fonts by full font file name, assuming that fonts are available in the user/fonts subdirectory of the MyBible data directory. A font can be downloaded as part of a bundle module, or can be placed manually to the user/fonts subdirectory of the MyBible data directory.  
   Example of specifying a font directly:  
   *This HTML content demonstrates how the \<font face='HelveticaNeueCyr-thin.otf'\>HelveticaNeueCyr\</font\> can be used.*  
   Example of specifying a font using a style:  
   *@font-face {*  
      *font-family: MyHeb;*  
      *src: url("TaameyFrankCLM-Medium.ttf");*  
   *}*   
   *.heb {*  
    *font-family: MyHeb;*  
    *font-weight: normal;*  
    *font-style: normal;*  
    *font-size: 125%;*  
    *color: %COLOR\_BLUE%;*  
   *}*  
   *\<span class='heb'\>...text in Hebrew...\</span\>*

3) In HTML content, MyBible supports several predefined text highlight colors \+ a default text color, as defined in a MyBible theme. The idea is that instead of explicit specifying of a font color in the HTML, which might not go well with the current theme colors, only color indexes are used in the HTML \<font\> tag, where the index can be from 0 to 5:  
   Plain text, \<font color=’1’\>text \<font color=’0’\>highlighted\</font\> with the first color\</font\>, plain text again, \<font color=’5’\>text highlighted with the 5th highlight color\</font\>.  
   Alternatively to an index, there is a predefined keyword for those colors:  
   index: 0, identical keyword: %COLOR\_TEXT%  
   index: 1, identical keyword: %COLOR\_RED%  
   index: 2, identical keyword: %COLOR\_GREEN%  
   index: 3, identical keyword: %COLOR\_BLUE%  
   index: 4, identical keyword: %COLOR\_PURPLE%  
   index: 5, identical keyword: %COLOR\_GREY%  
   Example:  
   *\<font color='1'\> &\#x03B2;&\#x03BF;&\#x0301;&\#x03C4;&\#x03C1;&\#x03C5;&\#x03C2;\</font\>\<p\> \<font color \=’ %COLOR\_BLUE%’ face='monospace'\>botrus\</font\>\<p\>\<i\>bot'-rooce\</i\>\<p\>Of uncertain derivation; a \<i\>bunch\</i\> (of grapes): \- (vine) cluster (of the vine). Shortened from \<a href='S:H352'\>H352\</a\>. See its usage in \<a href='B:10 3:8'\>Gen 3:8\</a\>.*

4) In HTML content, MyBible supports hyperlinks to Bible places, with a hyperlink target being one of the following::

   1) B:\<book number\> \<chapter number\>:\<verse number\>\[-\[\<end chapter number\>:\]\<end verse number\>\]

   2) B:\<book number\> \<chapter number\>:\<verse number \#1\>,\<verse number \#2\>\[\<more comma-separated verse numbers\>\]

   3) B:\<book number\> \<chapter number\>

   4) B:\<book number\> \<chapter number start\>-\<chapter number end\>

   The parts in square brackets are optional. \<book number\> is a reference to one of the predefined book numbers \- see the Bible Module description below.

5) In HTML content, MyBible supports hyperlinks to dictionary topics, with a hyperlink target being “S:\<topic\>”. In case of a Strong’s lexicon, a topic shall start with “G” or “H”.

6) In HTML content, MyBible supports of commentary articles hyperlinks to other commentary articles, with a hyperlink target being “C:@\<book number\> \<chapter number\>:\<verse number\>”, where \<book number\> is a reference to one of the predefined book numbers \- see the Bible Module description below.

7) In HTML content, MyBible supports external hyperlinks which start with http:// or https://

8) In HTML content, MyBible supports references to HTML fragments, which are specified in a separate table CONTENT\_FRAGMENTS (see above).  
   Such references can be specified as two kinds of special HTML comments:

   **\<\!-- INCLUDE(\<fragment ID\>) FROM(\<module\>) TEXTUAL(true|false) \--\>**  
   where:  
   **\<fragment ID\>** \- one of the IDs from the CONTENT\_FRAGMENTS table in a current or specified module, case-sensitive, no leading or trailing spaces.  
   **FROM(\<module\>)** \- an optional part defining a module to take a fragment from; \<module\> is an abbreviation of a module of the same type as a current module, or a module file name without the .SQLite3 suffix. If this part is omitted, a fragment is assumed to be from a current module.  
   **TEXTUAL(true|false)** \- an optional part that indicates whether this fragment contains textual information. If this part is omitted, or if a word in parentheses is not "true", a fragment is assumed to be not containing any user-readable textual information (an image, a script, etc.).

   Upon finding such an HTML comment with a fragment ID that exists in the CONTENT\_FRAGMENTS table of a specified module, MyBible replaces this entire comment with the content of the "fragment" field from the CONTENT\_FRAGMENTS table. Such a replacement of all the found fragment references is done before interpreting and rendering an HTML article being processed.

   Note that the application will protect itself from a recursive inclusion of a fragment into itself (and thus from an endless recursion), but a module developer shall still try to avoid such recursive inclusions of fragments.

HTML content example:  
*\<\!-- INCLUDE(publisher logo) \--\>*  
*\<h2\>Начало\</h2\>"Начало" служит вступлением ко всему Священному Писанию. В этой части Таурата говорится, что Всевышний \<a href='S:H1254'\>создал\</a\> Вселенную и всё, что в ней, включая человека (\<a href='B:10 1:1'\>гл.1-2\</a\>).\<p\>*  
*\<\!-- INCLUDE(creation\_picture\_1) \--\>*  
*И всё, что создал Всевышний, было совершенным и безгрешным (\<a href='B:10 1:31'\>1:31\</a\>). Но Он дал человечеству выбор: повиноваться Ему или нет (\<a href='B:10 2:16'\>2:16-17\</a\>). Когда Адам и Ева в Эдемском саду взбунтовались против Всевышнего, ослушавшись Его, всё творение подпало под власть греха и оказалось в плачевном состоянии. Так человек потерял самое основное и самое ценное, что у него было: близкие взаимоотношения со Всевышним (см. также \<a href='C:@10 3:8'\>комментарий к Быт 3:8\</a\>).*  
*\<\!-- INCLUDE(about\_koine) FROM(GSD) TEXTUAL(true) \--\>*  
*\<\!-- INCLUDE(greek\_scanned\_dictionary\_page1) FROM(GSD) TEXTUAL(false) \--\>*  
*\<\!-- INCLUDE(paul\_first\_journey) FROM(BMNT.commentaries) \--\>*  
*\<\!-- INCLUDE(support\_js) \--\>*

# 

# **Bible Module**

## **INFO Table**

There are the following Bible module configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| chapter\_string | A text that means “Chapter” in the module's language. If this text contains the “%s” placeholder, a chapter number will be inserted instead of “%s”, otherwise a chapter number will be added after the specified string, space-separated. Examples: “Chapter” for English, “Глава” for Russian, “第%s章” for Chinese. |
| chapter\_string\_ot | A replacement of chapter\_string for the Old Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament in Hebrew, New Testament in Greek). |
| chapter\_string\_nt | A replacement of chapter\_string for the New Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament in Hebrew, New Testament in Greek). |
| chapter\_string\_ps | A replacement of chapter\_string for the book of Psalms. |
| introduction\_string | A text that means “Introduction” in the module's language. This is needed in case if a module contains an introduction (see the INTRODUCTIONS table description below), and/or if a module contains non-empty “detailed\_info” record in this table (see the General section). |
| strong\_numbers | An indication that this Bible text in this module contains Strong’s numbers. Can be “true” or “false”, default is “false”. |
| right\_to\_left | An indication that this Bible module uses right-to-left writing. Can be “true” or “false”, default is “false”; shall be set to “true” for Hebrew and Arabic Bible translations. |
| right\_to\_left\_ot | A replacement of right\_to\_left for the Old Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament in Hebrew, New Testament in Greek). |
| right\_to\_left\_nt | A replacement of right\_to\_left for the New Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament in Hebrew, New Testament in Greek). |
| book\_list\_right\_to\_left | An indication that for this Bible module the books on the book selection screen shall be laid out right-to-left. Can be “true” or “false”, default is “false”. Usually set to “true” if book abbreviations in the module are in Hebrew or Arabic.If this parameter is not specified, MyBible uses for this the right\_to\_left parameter. |
| book\_list\_right\_to\_left\_ot | A replacement of book\_list\_right\_to\_left for the Old Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament book abbreviations in Hebrew, New Testament book abbreviations in Greek). |
| book\_list\_right\_to\_left\_nt | A replacement of book\_list\_right\_to\_left for the New Testament. Used in bi-lingual Bible modules, like Orig+ (Old Testament book abbreviations in Hebrew, New Testament book abbreviations in Greek). |
| digits0-9 | Presentation of the Arabic digits, 0 to 9, in the language of this Bible module. This is used to show Bible chapter and verse numbers in a local language. The assumption here is that a number in a local language has conceptually the same presentation as in English, and only the characters signifying digits are different. To become effective, this item shall contain exactly 10 characters. For instance, for Hindi Bible modules this parameter contains  ten Modern Devanagari digits: ०१२३४५६७८९ This configuration parameter is supported by MyBible 3.3.0 and up. |
| font\_scale | Specifies the font scaling when verses of this particular Bible module are shown. Default value is 1.0. The purpose of this is to have a better correspondence of a shown number of verses in English and in Arabic Bible modules when they are shown in parallel (the font scaling is set for Arabic Bible modules to 1.2). |
| strong\_numbers\_prefix | A fixed Strong Numbers’ prefix, to be applied to all Strong numbers in the module. This can be either “G” (meaning Greek) or “H” (meaning Hebrew). This configuration parameter is used rarely \- in fact, it is used only for Septuagint (set to “G”), as the Strong numbers in Septuagint (Old Testament) point to Greek Strong’s lexicon. |
| contains\_accents | An indication that accent characters are used in the text of this Bible module (and thus searching in the text needs to take actions to ignore accents). "true" or "false", a default value is "false". |
| add\_space\_before\_footnote\_marker | An indication that a space shall be artificially added before every footnote marker. "true" or "false", a default value is "false". |
| associated\_theme | A name of a theme that is suggested to be used with this Bible module. Note that association of a bundle with a Bible module is defined in the MyBible registry (not inside of a module), so that the association can be used before a Bible module is actually downloaded. |
| morphology\_topic\_reference\[\_\<language\>\] | Formatting string to show a hyperlink to a dedicated dictionary topic after a morphological form explanation (see description of the MORPHOLOGY\_TOPICS table below). There shall be as many such parameters as many values are used in the "language" field of the MORPHOLOGY\_INDICATIONS table, so the parameter names will be: "morphology\_topic\_reference\_ru" for Russian "morphology\_topic\_reference\_en" for English etc "morphology\_topic\_reference" for an unspecified language A value of each of these parameters must have two "%s" placeholders: the first for the dictionary topic to be used in the hyperlink, the second for the hyperlinked text. Example (for English): ", see \<a href="S:%s"\>%s\</a\>." |
| left\_guillemet\_on\_the\_right | An indication whether the module's text uses reversed double angle quotation marks, also known as guillemets. If the value is "true", the assumed quotation is »this is a quoted text with the left guillemet on the right«. If the value is "false", the assumed quotation is «this is a quoted text with the left guillemet on the left».By default, this parameter is assumed to be "true" for the following language codes: "de", "sv", "fi", "nb", "da". MyBible uses this parameter to know which guillemet is used on the right \- to remove spaces before such characters when forming the Bible text to copy. |

## **BOOKS Table**

The books table describes all the books present in the Bible module (i.e. in the VERSES table).

CREATE TABLE books (book\_number NUMERIC, book\_color TEXT, short\_name TEXT, long\_name TEXT, sorting\_order NUMERIC)

| Field name | Description |
| :---- | :---- |
| book\_number | The key field for this table. In MyBible, all Bible **books have fixed numbers assigned to them** (this is a legacy from PalmBible+). The table below lists these numbers. |
| book\_color | A color of the book abbreviation text to be used on the book selection screen of MyBible. The color is specified in the standard Android notation: \#rrggbb or \#aarrggbb. rr, gg, bb are two-digit hexadecimal values of the red, green, and blue color components. aa (if used) is a two-digit hexadecimal value of the alpha channel (opacity), with ff meaning fully opaque and 00 meaning fully transparent. All the Bible modules in the MyBible repository use the same color coding of the Bible books. However, you can modify color coding in this table and thus have an alternative color coding in your copy of a Bible module for MyBible. |
| short\_name | A book abbreviation, as it will be used on the book selection screen, on the references to Bible locations, etc. |
| long\_name | A book name, as it will be shown at the very top of a Bible book in the MyBible reading window. |
| sorting\_order | An optional numeric field for sorting of books in a custom order, pertinent to a particular Bible module. |

### **Books reference**

Here is the content of the BOOKS table, including non-canonical books, in Russian and in English

| book\_color | book\_number | short\_name (Rus) | long\_name (Rus) | short\_name (Eng) | long\_name (Eng) | Note |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| \#ccccff | 10 | Быт | Бытие | Gen | Genesis |  |
| \#ccccff | 20 | Исх | Исход | Exo | Exodus |  |
| \#ccccff | 30 | Лев | Левит | Lev | Leviticus |  |
| \#ccccff | 40 | Чис | Числа | Num | Numbers |  |
| \#ccccff | 50 | Втор | Второзаконие | Deu | Deuteronomy |  |
| \#ffcc99 | 60 | Нав | Иисус Навин | Josh | Joshua |  |
| \#ffcc99 | 70 | Суд | Судьи | Judg | Judges |  |
| \#ffcc99 | 80 | Руфь | Руфь | Ruth | Ruth |  |
| \#ffcc99 | 90 | 1Цар | 1-я Царств | 1Sam | 1 Samuel |  |
| \#ffcc99 | 100 | 2Цар | 2-я Царств | 2Sam | 2 Samuel |  |
| \#ffcc99 | 110 | 3Цар | 3-я Царств | 1Kin | 1 Kings |  |
| \#ffcc99 | 120 | 4Цар | 4-я Царств | 2Kin | 2 Kings |  |
| \#ffcc99 | 180 | Иудф | Иудифь |  |  |  |
| \#ffcc99 | 130 | 1Пар | 1-я Паралипоменон | 1Chr | 1 Chronicles |  |
| \#ffcc99 | 140 | 2Пар | 2-я Паралипоменон | 2Chr | 2 Chronicles |  |
| \#66ff99 | 145 | Мол | Молитва Манассии |  |  | Was 790 |
| \#ffcc99 | 150 | Ездр | Ездра | Ezr | Ezra |  |
| \#ffcc99 | 160 | Неем | Неемия | Neh | Nehemiah |  |
| \#ffcc99 | 165 | 2Езд | 2-я Ездры |  |  | Was 740 |
| \#ffcc99 | 170 | Тов | Товит | Tob | Tobit |  |
| \#ffcc99 | 190 | Есф | Есфирь | Esth | Esther |  |
| \#c0c0c0 | 192 |  |  | EsthGr | The rest of Esther, a.k.a. Additions to Esther |  |
| \#66ff99 | 220 | Иов | Иов | Job | Job |  |
| \#66ff99 | 230 | Пс | Псалтирь | Ps | Psalms |  |
| \#66ff99 | 240 | Прит | Притчи | Prov | Proverbs |  |
| \#66ff99 | 250 | Еккл | Екклесиаст | Eccl | Ecclesiastes |  |
| \#66ff99 | 260 | Песн | Песня Песней | Song | Song of Solomon |  |
| \#66ff99 | 270 | Прем | Премудрость Соломона | Wis | Wisdom of Solomon |  |
| \#66ff99 | 280 | Сир | Сирах | Sir | Sirach, a.k.a, “Ecclesiasticus” |  |
| \#ff9fb4 | 290 | Ис | Исаия | Isa | Isaiah |  |
| \#ff9fb4 | 300 | Иер | Иеремия | Jer | Jeremiah |  |
| \#c0c0c0 | 305 |  |  | PrAz | Prayer of Azariah |  |
| \#ff9fb4 | 310 | Плач | Плач Иеремии | Lam | Lamentations |  |
| \#ff9fb4 | 315 | Посл | Послание Иеремии | EpJer  | Epistle (or Letter) of Jeremiah |  |
| \#ff9fb4 | 320 | Вар | Варух | Bar | Baruch |  |
| \#c0c0c0 | 323 |  |  | Sg3 or S3y or SgThr | Song of the Three Young Men a.k.a. The Song of The Three Holy Children also Prayer of Azaria & Song of the Three |  |
| \#c0c0c0  | 325 |  |  | Sus  | Susanna, a.k.a. Daniel and Susana aka The History of Susanna |  |
| \#ff9fb4 | 330 | Иез | Иезекииль | Ezek | Ezekiel |  |
| \#ff9fb4 | 340 | Дан | Даниил | Dan | Daniel |  |
| \#c0c0c0 | 345 |  |  | Bel | Bel and the Dragon, a.k.a. The History of the Destruction of Bel and the Dragon, a.k.a. Daniel, Bel, and the Snake |  |
| \#ffff99 | 350 | Ос | Осия | Hos | Hosea |  |
| \#ffff99 | 360 | Иоил | Иоиль | Joel | Joel |  |
| \#ffff99 | 370 | Ам | Амос | Am | Amos |  |
| \#ffff99 | 380 | Авд | Авдий | Oba | Obadiah |  |
| \#ffff99 | 390 | Ион | Иона | Jona | Jonah |  |
| \#ffff99 | 400 | Мих | Михей | Mic | Micah |  |
| \#ffff99 | 410 | Наум | Наум | Nah | Nahum |  |
| \#ffff99 | 420 | Авв | Аввакум | Hab | Habakkuk |  |
| \#ffff99 | 430 | Соф | Софония | Zeph | Zephaniah |  |
| \#ffff99 | 440 | Агг | Аггей | Hag | Haggai |  |
| \#ffff99 | 450 | Зах | Захария | Zech | Zechariah |  |
| \#ffff99 | 460 | Мал | Малахия | Mal | Malachi |  |
| \#d3d3d3 | 462 | 1Мак | 1-я Маккавейская | 1Mac | 1 Maccabees | Was 200 |
| \#d3d3d3 | 464 | 2Мак | 2-я Маккавейская | 2Mac | 2 Maccabees | Was 210 |
| \#d3d3d3 | 466 | 3Мак | 3-я Маккавейская | 3Mac | 3 Maccabees |  |
| \#d3d3d3 | 467 | 4Ма | 4-я Маккавейская | 4Mac | 4 Maccabees |  |
|  \#d3d3d3 | 468 | 3Езд | 3-я Ездры | 2Esd | 2 Esdras | Was 750 |
| \#ff6600 | 470 | Мат | От Матфея | Mat | Matthew |  |
| \#ff6600 | 480 | Мар | От Марка | Mar | Mark |  |
| \#ff6600 | 490 | Лук | От Луки | Luk | Luke |  |
| \#ff6600 | 500 | Ин | От Иоанна | John | John |  |
| \#00ffff | 510 | Деян | Деяния | Acts | Acts |  |
| \#00ff00 | 660 | Иак | Иакова | Jam | James |  |
| \#00ff00 | 670 | 1Пет | 1-е Петра | 1Pet | 1 Peter |  |
| \#00ff00 | 680 | 2Пет | 2-е Петра | 2Pet | 2 Peter |  |
| \#00ff00 | 690 | 1Ин | 1-е Иоанна | 1Jn | 1 John |  |
| \#00ff00 | 700 | 2Ин | 2-е Иоанна | 2Jn | 2 John |  |
| \#00ff00 | 710 | 3Ин | 3-е Иоанна | 3Jn | 3 John |  |
| \#00ff00 | 720 | Иуд | Иуды | Jud | Jude |  |
| \#ffff00 | 520 | Рим | К Римлянам | Rom | Romans |  |
| \#ffff00 | 530 | 1Кор | 1-е Коринфянам | 1Cor | 1 Corinthians |  |
| \#ffff00 | 540 | 2Кор | 2-е Коринфянам | 2Cor | 2 Corinthians |  |
| \#ffff00 | 550 | Гал | К Галатам | Gal | Galatians |  |
| \#ffff00 | 560 | Еф | К Ефесянам | Eph | Ephesians |  |
| \#ffff00 | 570 | Флп | К Филиппийцам | Phil | Philippians |  |
| \#ffff00 | 580 | Кол | К Колоссянам | Col | Colossians |  |
| \#ffff00 | 590 | 1Фес | 1-е Фессалоникийцам | 1Ths | 1 Thessalonians |  |
| \#ffff00 | 600 | 2Фес | 2-е Фессалоникийцам | 2Ths | 2 Thessalonians |  |
| \#ffff00 | 610 | 1Тим | 1-е Тимофею | 1Tim | 1 Timothy |  |
| \#ffff00 | 620 | 2Тим | 2-е Тимофею | 2Tim | 2 Timothy |  |
| \#ffff00 | 630 | Тит | К Титу | Tit | Titus |  |
| \#ffff00 | 640 | Флм | К Филимону | Phlm | Philemon |  |
| \#ffff00 | 650 | Евр | К Евреям | Heb | Hebrews |  |
| \#ff7c80 | 730 | Откр | Откровение | Rev | Revelation |  |
| \#00ff00 | 780 | Лаод | К Лаодикийцам | Lao | To the Laodiceans |  |

 

## **BOOKS\_ALL Table**

The books\_all table contains ***all the Bible books***, with an additional field is\_present that indicates whether a book is actually present in the Bible module (i.e. in the VERSES table).

MyBIble 4.4.3 alpha14 or a later version knows about both the books\_all and the BOOKS table: it looks for the BOOKS\_ALL table first and only if it is not found uses the BOOKS table.

CREATE TABLE books\_all (book\_number NUMERIC, book\_color TEXT, short\_name TEXT, title TEXT, long\_name TEXT, is\_present BOOLEAN, sorting\_order NUMERIC)

| Field name | Description |
| :---- | :---- |
| book\_number | The key field for this table. In MyBible, all Bible **books have fixed numbers assigned to them** (this is a legacy from PalmBible+). The table below lists these numbers. |
| book\_color | A color of the book abbreviation text to be used on the book selection screen of MyBible. The color is specified in the standard Android notation: \#rrggbb or \#aarrggbb. rr, gg, bb are two-digit hexadecimal values of the red, green, and blue color components. aa (if used) is a two-digit hexadecimal value of the alpha channel (opacity), with ff meaning fully opaque and 00 meaning fully transparent. All the Bible modules in the MyBible repository use the same color coding of the Bible books. However, you can modify color coding in this table and thus have an alternative color coding in your copy of a Bible module for MyBible. |
| short\_name | A book abbreviation, as it will be used on the book selection screen, on the references to Bible locations, etc. |
| title | A title, as it will be shown at the very top of a Bible book in the Bible window. This is an optional field; if not present or empty \- a value from the "long\_name" field is used for the book title in the Bible window. |
| long\_name | A full book name, to be used in cases other than the book title in the Bible window. |
| is\_present | Contains 1, if a book is actually present in the bible module, otherwise 0\. |
| sorting\_order | An optional numeric field for sorting of books in a custom order, pertinent to a particular Bible module. |

## **VERSES Table**

This table contains the text of a Bible module, one verse per record

CREATE TABLE verses (book\_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT)

CREATE UNIQUE INDEX verses\_index ON verses (book\_number, chapter, verse)

| Field name | Description |
| :---- | :---- |
| book\_number | For every used book\_number value, there must be a corresponding record in the BOOKS table. However, this integrity is not enforced on the database level, so if it is violated, “orphan” verses will become inaccessible in MyBible. |
| chapter | Chapter numbers for every book shall start from 1 and shall not have “numbering gaps”. MyBible defines the number of chapters in each particular book by querying the maximum chapter number for a book from this table. |
| verse | A verse number. Verse numbers shall start from 1 and shall not have “numbering gaps”. In case if there is no text for a particular verse in a Bible module, a record with the empty text field shall still be present for that verse. For example, if verses 1 and 2 are consolidated in a translation of a particular psalm, there shall still be a record for verse 2, with empty text. |
| text | Verse text. May contain embedded tags \- see the following table. |

### **Supported embedded tags for the verses.text field**

| Tag | Description |
| :---- | :---- |
| \<S\>…\</S\> | The pair of tags specifying that a text inside the tagged area contains exactly one Strong’s number, without the “H” or “G” prefix, 1 to 4 digits and nothing else. (The Bible book a verse belongs to defines the Hebrew (“H”) or Greek (“G”) language of the corresponding Bible manuscript). Examples: *In the beginning\<S\>7225\</S\> God\<S\>430\</S\> created\<S\>1254\</S\> \<S\>853\</S\> the heaven\<S\>8064\</S\> and the earth.\<S\>776\</S\> ...и\<S\>2532\</S\> прилепится\<S\>4347\</S\> \<S\>3588\</S\> к жене\<S\>1135\</S\>....* |
| \<m\> …\</m\> | The pair of tags specifying that a text inside the tagged area contains a morphology indication for a preceding Strong’s number. |
| \<i\>…\</i\>  | The pair of tags specifying that a text inside the tagged area represents inserted word(s), i.e. not present in the Hebrew or Greek Bible manuscript and added just for a sentence coherence in the module's language. Example: *And the earth was without form, and void; and darkness \<i\>was\</i\> upon the face of the deep.* |
| \<J\> … \</J\> | The pair of tags specifying that a text inside the tagged area represents the words of Jesus in the New Testament and the words of God in the Old Testament. An example below combines Jesus’ words and Strong’s numbers marking: *\<S\>1161\</S\> Jesus\<S\>2424\</S\> said\<S\>2036\</S\> unto him,\<S\>846\</S\> \<J\>Thou\</J\> \<J\>shalt\</J\> \<J\>love\</J\>\<S\>25\</S\> \<J\>the\</J\> \<J\>Lord\</J\>\<S\>2962\</S\> \<J\>thy\</J\>\<S\>4675\</S\> \<J\>God\</J\>\<S\>2316\</S\> ...* |
| \<n\> … \</n\> | А pair of tags specifying that a text inside the tagged area represents a note (an explanation) added to the Bible text. Example: *But there went up a mist from the earth, and watered the whole face of the ground. \<n\>there…: or, a mist which went up from, etc.\</n\>* |
| \<e\> … \</e\> | The pair of tags specifying that a text inside the tagged area shall be emphasized in the Bible reading window. |
| \<t\> … \</t\> | The pair of tags specifying that a text inside the tagged area shall start from a new line and have an indent from left and right. This is the way to show: \- a quotation from the Old Testament in the New Testament \- poetic insertions and similar things in Psalms. |
| \<br/\> | A single tag indicating that a line break shall be performed there. |
| \<pb/\> | A single tag indicating that a paragraph break shall be performed here. If there are such tags in a Bible module, verses will start on a new line only if they are first verses of a book or of a book chapter, or after this tag is found in a verse. |
| \<f\> ... \</f\> | Surround a footnote marker, which will be represented as a hyperlink to access a footnote for the verse \- a footnote having the same footnote marker as the text surrounded by these tags. Example: *\<pb/\>Земля была пуста и пустынна, тьма была над пучиной, и дух \<f\>\[1\]\</f\> Божий веял над водами.* |
| \<h\> … \</h\> | А pair of tags specifying that a text inside the tagged area represents a subheading embedded into a verse; this allows showing subheadings in the middle of a verse. A resulting subheading will look the same as a regular subheading, that is, will automatically be placed on a separate line, will use the same appearance settings as regular subheadings, and will be hidden when showing of subheadings is turned off in MyBible. Example: *Draw me after you; let us run. The king has brought me into his chambers.\<h\>Others\</h\>We will exult and rejoice in you; we will extol your love more than wine; rightly do they love you.* |

## **INTRODUCTIONS Table**

This table allows providing introductions for a book as a whole and for book chapters. This table is optional.

CREATE TABLE introductions (book\_number NUMERIC, introduction TEXT, PRIMARY KEY (book\_number))

## 

| Field name | Description |
| :---- | :---- |
| book\_number | Book number. If 0, this is an introduction for the entire Bible module. |
| introduction | Introduction text, in HTML format, without \<html\> and \<body\> tags. Hyperlinks to Bible places can be used in an introduction text, with a hyperlink target being “B:\<book number\> \<chapter number\>:\<verse number\>”, where \<book number\> is a reference to one of the predefined book numbers \- see the Bible module description. Hyperlinks to the Internet (with a hyperlink target starting with “http://”) can be used in an introduction text. |

## 

## **STORIES Table**

This table allows to provide subheadings from a corresponding printed Bible. This table is optional \- may not be present at all. In fact, it is rarely used because it was replaced with separate subheadings modules, which, if downloaded, allow to use subheadings from them with all the downloaded Bible modules.

CREATE TABLE stories (book\_number NUMERIC, chapter NUMERIC, verse NUMERIC, order\_if\_several NUMERIC, title TEXT)

CREATE UNIQUE INDEX stories\_index ON stories(book\_number, chapter, verse, order\_if\_several)

| Field name | Description |
| :---- | :---- |
| book\_number | A reference to one of the predefined book numbers \- see the Bible module description. |
| chapter | A reference to a chapter of the specified book. |
| verse | A verse number in the specified Bible chapter this subheading shall be shown before. |
| order\_if\_several | An order of subheadings specified for the same verse, if there are several of them. Can be NULL. |
| title | A subheading text. See description of the subheadings.text field (Subheadings module). |

## **MORPHOLOGY\_INDICATIONS Table**

This optional table contains data describing word morphology indication items used in this particular Bible module along with Strong’s numbers (a morphology indication item can be present after a Strong’s number).

This table is similar in structure to the same-named table in dictionary modules, but has an additional "language" field.

Here is the algorithm of how MyBible uses the MORPHOLOGY\_INDICATIONS tables in a Bible module and in the currently selected Strong lexicon module in order to find a morphology indication meaning:

1. Look in the Bible module for the language of the currently selected Strong's lexicon module.  
2. If not found, look in the currently selected Strong's lexicon module.  
3. If not found, look in the Bible module for the current MyBible user interface language.  
4. If not found, look in the Bible module for English (language \= "en").  
5. If not found, look in the Bible module for an unspecified language.  
6. If not found \- the meaning of the morphology indication is unknown.

CREATE TABLE morphology\_indications (indication TEXT, applicable\_to TEXT, language as TEXT, meaning TEXT)

CREATE UNIQUE INDEX morphology\_indications\_index ON morphology\_indications (indication ASC, applicable\_to, language ASC)

| Field name | Description |
| :---- | :---- |
| indication | A distinct part of a morphology indication item. |
| applicable\_to | The first part of the morphology indication item to which this part is applicable to. If empty, the part is applicable to all the morphology indication items. |
| language | Code of a language this entry is applicable for. For details of how the value is formed see the "language" parameter description in the "INFO Table" common section. |
| meaning | Morphology meaning for this morphology indication part, as it shall be presented to the user in the Strong’s lexicon window. |

## **MORPHOLOGY\_TOPICS Table**

This optional table contains correspondence between full (not partial) morphology indications and dedicated dictionary topics on these particular morphological forms.

MyBible looks for this table only if the MORPHOLOGY\_INDICATIONS table is present \- see above.

A record in this table causes a hyperlink to a corresponding dictionary topic to appear in the Strong’s Lexicon window after the morphological form explanation. A needed condition  for this is the presence of the "morphology\_topic\_reference\[\_\<language\>\]" parameter in the INFO table, where "\<language\>" is the language the morphology indication meaning was found for, see the description of the MORPHOLOGY\_INDICATIONS table above; so the parameter needed will be "morphology\_topic\_reference\_ru" for Russian, "morphology\_topic\_reference\_en" for English, "morphology\_topic\_reference" if the morphology meaning was found for an unspecified language.

CREATE TABLE morphology\_topics (indication TEXT, topic TEXT)

CREATE UNIQUE INDEX morphology\_topics\_index ON morphology\_topics (indication ASC)

## 

| Field name | Description |
| :---- | :---- |
| indication | Full (not partial) indication of a morphological form. E.g. “V-PAN”, “V-2ADM”. |
| topic | Dictionary topic dedicated to the specified morphological form. E.g. “G5721”, “G5634”. |

# **Dictionary Module**

## **INFO Table**

There are the following commentary module configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| language | For a dictionary module, this standard parameter identifies a language of Bible modules this dictionary can be used for. |
| articles\_language | Identifies a language in which the dictionary articles are written. If this parameter is not specified, the articles are assumed to be written in the language specified by the “language” parameter. This parameter only affects a language group in the “Modules” window, in which a dictionary module is to be shown. |
| is\_strong | Indication that this dictionary is a Strong’s lexicon. “true” or “false”; if not specified, “true” is assumed. This is a legacy parameter; the “type” parameter, if specified, has a priority. |
| type | Dictionary module type. If this parameter is defined, the “is\_strong” parameter is ignored. Possible values for the “type”: “explanatory”. This type of dictionary explains terms (Biblical and/or general), and is usually oriented on the users freely reading in a language of this dictionary. “translator”. This type of dictionary explains words of the language of this dictionary in another language. “concordance”. This type of dictionary explains word forms that occur in a Bible module. “lexicon”. Presents an alternative to a Strong’s lexicon for Bible modules having no embedded Strong’s numbers, which can be especially useful for “rare” languages. “strong lexicon”. Presents Strong’s numbers as topics, with explaining articles. Normalized form 1 and 2 are not applied to topics of the “strong lexicon” dictionary. |
| standard\_form\_matching\_type | Specifies how MyBIble shall match values of the “WORDS.standard\_form” field against the DICTIONARY.topic field, see see the “Dictionary Lookup Tables” section below.Possible values are: “exact” “normalized form 1” “normalized form 2” (this is the default value) |
| morphology\_topic\_reference | Formatting string to show a hyperlink to a dedicated dictionary topic after a morphological form explanation (see description of the MORPHOLOGY\_TOPICS table below). Must have two "%s" placeholders: the first for the dictionary topic to be used in the hyperlink, the second for the hyperlinked text. Example: ", see \<a href="S:%s"\>%s\</a\>." |
| cognate\_strong\_numbers\_info | Formatting string to present cognate Strong’s numbers info, with the “%s” placeholder for the place where actual numbers shall be placed. An example of this value: “Cognate Strong’s numbers: %s”. If this item is not provided or is empty, cognate Strong’s numbers will not be programmatically added to lexicon articles (which is helpful if lexicon articles already contain cognate Strong number information prepared and formatted by the lexicon developer). |
| synonymous\_strong\_numbers\_info | Formatting string to present synonymous Strong’s numbers info, with the “%s” placeholder for the place where actual numbers shall be placed. An example of this value: “Synonymous Strong’s numbers: %s”. If this item is not provided or is empty, synonymous Strong’s numbers will not be programmatically added to lexicon articles (which is helpful if lexicon articles already contain synonymous Strong number information prepared and formatted by the lexicon developer). |
| informative\_references\_to\_verses | Indication that this dictionary needs to be processed for inclusion into the “References to selected verse from active dictionaries” functionality, “true” or “false”; by default this value is “false”.Note: before MyBible 4.6, all the downloaded dictionaries were scanned for references to verses for the mentioned functionality. As of MyBible 4.6, due to undertaken performance optimization for dictionaries indexing, each dictionary needs to be explicitly marked with this parameter to be included into the “References to selected verse from active dictionaries” functionality. |
| default\_topic | A topic to be used by default in case the last topic selected by the user is not present in the current dictionary. A default topic typically contains a dictionary's start page, with links to main parts. |

## **DICTIONARY Table**

This table contains dictionary data.

This table can be absent in a dictionary module, and if it is absent, a module is not a fully functional dictionary module but only a carrier of word forms info, and it will not be shown in a dictionary selection list in the app.

CREATE TABLE dictionary (topic TEXT, definition TEXT NOT NULL, short\_definition TEXT, lexeme TEXT, transliteration TEXT, pronunciation TEXT)

CREATE UNIQUE INDEX dictionary\_topic ON dictionary(topic ASC)

| Field name | Description |
| :---- | :---- |
| topic | A dictionary topic, i.e. a keyword to search for. For Strong’s numbers, this is a full Strong’s number, with the “H” or “G” prefix to denote a Hebrew word or a Greek word. Examples: *“G1”, “G1205”, “H940”, “H8554”* For Strong’s lexicon modules, in order for cross-topic hyperlinks to work correctly, all the values of the “topic” field shall start with “H” (for Hebrew words), with “G” (for Greek words), or with “\\u2042” (⁂ \- for ancillary,term explanation topics). |
| definition | A dictionary article, in HTML form, as defined by the "HTML Content" section above*.* |
| short\_definition | For Strong’s lexicons, contains a short definition of a Strong’s number in the “topic” field. This is an optional field. |
| lexeme | For Strong’s lexicons, contains a word in the original language, Hebrew or Greek, that corresponds to a Strong’s number in the “topic” field.This is an optional field. |
| transliteration | For Strong’s lexicons, contains a transliteration of a word in the original language, Hebrew or Greek, that corresponds to a Strong’s number in the “topic” field.This is an optional field. |
| pronunciation | For Strong’s lexicons, contains a pronunciation of a word in the original language, Hebrew or Greek, that corresponds to a Strong’s number in the “topic” field.This is an optional field. |

## **LOOKUP\_TOPICS Table**

This is a pre-indexing table for DICTIONARY. It can be created in a dictionary module to speed up its indexing before usage.

CREATE TABLE lookup\_words (topic TEXT, topic\_nf2 TEXT, topic\_has NUMERIC NOT NULL DEFAULT 0\)

## 

| Field name | Description |
| :---- | :---- |
| topic | A value from the DICTIONARY.topic field. |
| topic\_nf2 | See LOOKUP\_TOPICS table in the “Dictionary Lookup Tables and Views” section. |
| topic\_hash | See LOOKUP\_TOPICS table in the “Dictionary Lookup Tables and Views” section. |

## **MORPHOLOGY\_INDICATIONS Table**

This table contains data describing word morphology indication items that can be used in a Bible module along with Strong’s numbers (a morphology indication item can be present after a Strong’s number item).

This table, if present, applies only to topics present in the same dictionary. However, if the dictionary abbreviation matches the language code (e.g. “ru” for Russian, “en” for English, “el” for Greek), MyBible treats this table as applicable to all dictionaries in the same language.. 

CREATE TABLE morphology\_indications (indication TEXT, applicable\_to TEXT, meaning TEXT)

CREATE UNIQUE INDEX morphology\_indications\_index ON morphology\_indications (indication ASC, applicable\_to ASC)

| Field name | Description |
| :---- | :---- |
| indication | A distinct part of a morphology indication item. |
| applicable\_to | The first part of the morphology indication item to which this part is applicable to. If empty, the part is applicable to all the morphology indication items. |
| meaning | Morphology meaning for this morphology indication part, as it shall be presented to the user in the Strong’s lexicon window. |

## **MORPHOLOGY\_TOPICS Table**

This table contains correspondence between full (not partial) morphology indications and dedicated dictionary topics on these particular morphological forms.

MyBible looks for this table only if the MORPHOLOGY\_INDICATIONS table is present \- see above.

A record in this table causes a hyperlink to a corresponding dictionary topic to appear in the Strong’s Lexicon window after the morphological form explanation. A needed condition  for this is the presence of the "morphology\_topic\_reference" parameter in the INFO table.

CREATE TABLE morphology\_topics (indication TEXT, topic TEXT)

CREATE UNIQUE INDEX morphology\_topics\_index ON morphology\_topics (indication ASC)

## 

| Field name | Description |
| :---- | :---- |
| indication | Full (not partial) indication of a morphological form. E.g. “V-PAN”, “V-2ADM”. |
| topic | Dictionary topic dedicated to the specified morphological form. E.g. “G5721”, “G5634”. |

## **COGNATE\_STRONG\_NUMBERS Table**

This table can be placed to a dictionary module of the “strong lexicon” type. It carries information on cognate Strong’s numbers, so that they can be shown within a Strong’s lexicon article.

CREATE TABLE cognate\_strong\_numbers (group\_id NUMERIC, strong\_number TEXT)

CREATE INDEX cognate\_strong\_numbers\_group on cognate\_strong\_numbers(group\_id)

CREATE INDEX cognate\_strong\_numbers\_number on cognate\_strong\_numbers(strong\_number)

## 

| Field name | Description |
| :---- | :---- |
| group\_id | A numeric field grouping cognate Strong’s numbers: all the cognate ones have the same value of the group\_id field. Note that a value in this field has no interpretation, it just groups several Strong’s numbers into a cognate group, so that all of them in a group have the same group\_id value. |
| strong\_number | A Strong’s number that belongs to a group identified by group\_id value.. |

## **SYNONYMOUS\_STRONG\_NUMBERS Table**

This table can be placed to a dictionary module of the “strong lexicon” type. It carries information on synonymous Strong’s numbers, so that they can be shown within a Strong’s lexicon article.

CREATE TABLE synonymous\_strong\_numbers (group\_id NUMERIC, strong\_number TEXT)

CREATE INDEX synonymous\_strong\_numbers\_group on synonymous\_strong\_numbers(group\_id)

CREATE INDEX synonymous\_strong\_numbers\_number on synonymous\_strong\_numbers(strong\_number)

## 

| Field name | Description |
| :---- | :---- |
| group\_id | A numeric field grouping synonymous Strong’s numbers: all the synonymous ones have the same value of the group\_id field. Note that a value in this field has no interpretation, it just groups several Strong’s numbers into a synonymous group, so that all of them in a group have the same group\_id value. |
| strong\_number | A Strong’s number that belongs to a group identified by group\_id value.. |

## **WORDS Table**

This optional table makes correspondence of various word forms to those words which are suitable for dictionary lookup, in the language of this module.

MyBible treats this table as covering only words (topics) present in the same dictionary. However, if the dictionary abbreviation matches the language code (e.g. “ru” for Russian, “en” for English, “el” for Greek), MyBible treats this table as applicable to all dictionaries in the same language.

CREATE TABLE words (standard\_form TEXT, variation TEXT)

or:

CREATE TABLE words (variation TEXT, standard\_form TEXT, book\_number NUMERIC NOT NULL DEFAULT 0, chapter\_number NUMERIC NOT NULL DEFAULT 0, verse\_number NUMERIC NOT NULL DEFAULT 0\)

There are no unique indexes on this table (to reduce the size of dictionary modules having this table), but it is assumed that the table does not contain repeating variations.

| Field name | Description |
| :---- | :---- |
| variation | A word variation, or several variations for the same standard form. If there are several variations, they are to be separated by the vertical pipe character | (\\u007c), e.g.: "go|went|gone". |
| standard\_form | A word’s standard form, for looking up in the “DICTIONARY.topic” field. This value is the same for all forms of the same word. |
| book\_number | An optional field (may be absent). A book number where the word form correspondence is actual.  |
| chapter\_number | An optional field (may be absent). A chapter number where the word form correspondence is actual.  |
| verse\_number | An optional field (may be absent). A verse number where the word form correspondence is actual. |

## **LOOKUP\_WORDS Table**

This is a pre-indexing table for WORDS. It can be created in a dictionary module to speed up its indexing before usage.

CREATE TABLE lookup\_words (variation TEXT, standard\_form TEXT, book\_number NUMERIC NOT NULL DEFAULT 0, chapter\_number NUMERIC NOT NULL DEFAULT 0, verse\_number NUMERIC NOT NULL DEFAULT 0\)

## 

| Field name | Description |
| :---- | :---- |
| word\_nf1 | A Normalized Form 1 of a word form that can be found in a Bible module. |
| word\_nf2 | A Normalized Form 2 of a word form that can be found in a Bible module. |
| topic\_hash3 | See LOOKUP\_WORDS table in the “Dictionary Lookup Tables and Views” section. |
| topic\_hash2 | See LOOKUP\_WORDS table in the “Dictionary Lookup Tables and Views” section. |
| topic\_hash1 | See LOOKUP\_WORDS table in the “Dictionary Lookup Tables and Views” section. |
| book\_number | Content of the WORDS.book\_number field. |
| chapter\_number | Content of the WORDS.chapter\_number field. |
| verse\_number | Content of the WORDS.verse\_number field. |

## **WORDS\_PROCESSING Table**

This table provides data for words pre-processing and post-processing, as part of the Dictionary Lookup (see below).

MyBible treats this table as covering only words (topics) present in the same dictionary. However, if the dictionary’s abbreviation matches the language code (e.g. “de” for German, “en” for English), MyBible treats this table as applicable to all dictionaries in the same language.

Filling of this table is NOT needed for the following languages, because for performance reasons the corresponding processing is hardcoded into MyBible:

* Greek  
* Hebrew  
* Russian  
* Syriac variety of Aramaic

CREATE TABLE words\_processing (type TEXT, input TEXT, output TEXT)

| Field name | Description |
| :---- | :---- |
| type | Processing type, “pre” for pre-processing, “post” for post-processing (records with other values in this field are ignored). |
| input | Input character sequence, in the language of the dictionary. |
| output | Output character sequence, in the language of the dictionary. |

## **LOOKUP\_REFERENCES Table**

This is a table of pre-indexed references from dictionary topics to Bible verses. It can be created in a dictionary module to speed up its indexing before usage.

CREATE TABLE lookup\_references (topic TEXT, book\_number NUMERIC, chapter\_number NUMERIC, verse\_number NUMERIC)

## 

| Field name | Description |
| :---- | :---- |
| topic | A dictionary topic, as it is specified in the DICTIONARY table. |
| book\_number | Bible book referenced from the specified topic. |
| chapter\_number | Bible chapter referenced from the specified topic. |
| verse\_number | Bible verse referenced from the specified topic. |

## **Dictionary Lookup**

The following captures how MyBible operates in order to show a dictionary article upon clicking a word in a Bible module.

The goal of the dictionary lookup is to quickly show an expected dictionary article to the user (based on the current dictionary selection) without showing of dictionary articles selection, if possible. 

### **Lookup Mode**

MyBible supports two modes of operations with dictionaries on double-tapping a word in the Bible text: ‘Strong’ and ‘Dictionaries’.

* In the ‘Strong’ Lookup Mode MyBible first tries to find an article in dictionaries of the ‘strong lexicon’ type by a Strong’s number of a tapped word.

* In the ‘Dictionaries’ Lookup Mode MyBible first tries to find articles for a tapped word in dictionaries of a type other than ‘strong lexicon’.

The user can show the Lookup Mode Indicator & Control by swiping up or down on the module selection button in the Bible window.

In addition to the Lookup Mode Indicator & Control, the user can switch between the ‘Strong’ and ‘Dictionaries’ mode in the following ways:

1) By tapping the “Switch between Strong’s lexicon and dictionaries” button in the header of the Dictionary window.

2) By long-touching the ‘\>\>’ button below the Dictionary Balloon.

3) By selecting a Current Dictionary or Current Strong’s Lexicon from the list called from the Dictionary Window or from the Dictionary Balloon.

### **Current Strong’s Lexicon**

The current Strong’s lexicon is a dictionary of type ‘strong lexicon’ the user has explicitly selected from the list of Strong’s Lexicon called from the Dictionary Window or Dictionary Balloon.

### **Current Dictionary**

The current dictionary is the dictionary of a type other than ‘strong lexicon’ that the user has explicitly selected from the list of dictionaries (called from the Dictionary Window or the Dictionary Balloon).

### **Normalized Word Forms**

In order to match a word from a Bible module with a dictionary article, MyBible uses normalized word forms.

Normalized Form 1 (NF1) is obtained from a word by the following operations:

1) Language-specific pre-processed is made by replacing sequences of characters known as frequent scanning errors with corresponding correct sequences of characters. This pre-processing is data-driven \- see the WORDS\_PROCESSING table above.

2) Converted to lowercase.

3) Diacritics (if exist in the language) are kept but ensured to be separate Unicode codepoints (that is, compound characters with diacritics are decomposed into simple characters preceded by or followed by diacritic characters).

4) Language-specific post-processing is made, in order to achieve a better unification of a word. The post-processing is data-driven, see the WORDS\_PROCESSING table above. A sample post-processing for Russian: accent characters (U+0301) removed. A sample processing for Greek: the Grave Accent (Greek Varia, U+0060 or U+1FEF) is replaced with the Acute Accent (Greek Oxia, U+1FFD).

Normalized Form 2 (NF2) is obtained from a word by the following operations:

1) Pre-processed for the language (same as item 1 in Normalized Form 1).

2) Converted to lowercase.

3) All diacritic characters removed.

4) Post-processed for the language (same as item 4 in Normalized Form 1).

Normalized Form 0 (NF0) is obtained from a word by the following operations:

1) Pre-processed for the language (same as item 1 in Normalized Form 1).

2) Diacritics (if exist in the language) are kept but ensured to be separate Unicode codepoints (that is, compound characters with diacritics are decomposed into simple characters preceded by or followed by diacritic characters).

3) Post-processed for the language (same as item 4 in Normalized Form 1).

### **Dictionary Lookup Data**

In order to support quick dictionary lookup, MyBible maintains dictionary lookup data structures described below. How exactly these data are organized underneath and how they are generated is described below in the subsections “Dictionary Lookup Table and Views” and “Dictionary Lookup Data Generation”.

The data structure described below exist in a single instance each. MyBible maintains them for the entire set of downloaded dictionary modules.

#### **TOPICS\_BY\_WORD1, TOPICS\_BY\_WORD2**

The TOPICS\_BY\_WORD1 and TOPICS\_BY\_WORD2 are views that serve for finding dictionary topics by a word form from a Bible module. They both have the same structure:

| Field name | Description |
| :---- | :---- |
| word\_nf | A Normalized Form 1 or Normalized Form 2 of a word form that can be found in a Bible module. |
| topic | A dictionary topic that corresponds to the word. Specified exactly as it is in the “topic” field of a particular dictionary module. |
| language | Value of the “language” parameter of a dictionary module a topic belongs to. In case of topics from “strong lexicon” type, the value of this field is “Original”. |
| dictionary\_name | Abbreviation of a dictionary a topic belongs to.  |
| dictionary\_type | Value of the “type” parameter of a dictionary module a topic belongs to. If a dictionary module does not have the “type” parameter defined, there are the following special cases: If a dictionary module has the “is\_strong” parameter defined as “true”, the dictionary type will be “strong lexicon”. In all the other cases the dictionary type will be “explanatory”. |
| book\_number | If not 0, indicates a Bible book number where the word form to topic correspondence defined by this record is actual. |
| chapter\_number | If not 0, indicates a chapter number (for the book\_number above) where a word form to topic correspondence defined by this record is actual. |
| verse\_number | If not 0, indicates a verse number (for the book\_number and chapter\_number above) where a word form to topic correspondence defined by this record is actual. |

#### **TOPICS\_BY\_TOPIC**

The TOPICS\_BY\_TOPIC is a view that serves for finding dictionary topics by a referenced topic from a dictionary article or from any other auxiliary module, by a hyperlink of the following style:  
\<a href=’S:topic’\>...\</a\>.

The view has the following structure:

| Field name | Description |
| :---- | :---- |
| \_id | Rowid of a record (needed for internal purposes of the application). |
| topic | A dictionary topic that corresponds to the word. Specified exactly as it is in the “topic” field of a particular dictionary module. |
| topic\_nf2 | NF2(topic) |
| language | Value of the “language” parameter of a dictionary module a topic belongs to. In case of topics from “strong lexicon” type, the value of this field is “Original”. |
| dictionary\_name | Abbreviation of a dictionary a topic belongs to.  |
| dictionary\_type | Value of the “type” parameter of a dictionary module a topic belongs to. If a dictionary module does not have the “type” parameter defined, there are the following special cases: If a dictionary module has the “is\_strong” parameter defined as “true”, the dictionary type will be “strong lexicon”. If a dictionary does not have the “is\_strong” parameter defined and does not contain topics that are not Strong’s numbers (start with “G” or “H”) and not special topics of terms definition (start with “⁂”, which is ASTERISM, U+2042), the dictionary type will be “strong lexicon”. In all the other cases the dictionary type will be “explanatory”. |

### **Regular Words Lookup**

When looking up dictionary topics for a word form tapped by the user in a Bible module, MyBible uses the topics\_by\_word1 and topics\_by\_word2 views. There are two stages of the lookup:

1) Stage 1: use NF1 and NF2 of a word form being looked up. This stage uses the following query:

   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word1  
   WHERE word\_nf \= ‘\<NF1\>’  
   AND language IN (\<list of language codes\>)  
   AND matching\_type \<\> 2  
   UNION  
   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word2  
   WHERE word\_nf \= ‘\<NF1\>’  
   AND language IN (\<list of language codes\>)  
   AND matching\_type \<\> 2

   UNION

   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word1  
   WHERE word\_nf \= ‘\<NF2\>’  
   AND language IN (\<list of language codes\>)  
   AND matching\_type \= 2  
   UNION  
   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word2  
   WHERE word\_nf \= ‘\<NF2\>’  
   AND language IN (\<list of language codes\>)

   AND matching\_type \= 2

   

2) Stage 2: use only NF2 of a word form being looked up. This stage uses the following query:

   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word1  
   WHERE word\_nf \= ‘\<NF2\>’  
   AND language IN (\<list of language codes\>)  
   UNION  
   SELECT  
      word\_nf, topic, language, dictionary\_name, dictionary\_type,  
      book\_number, chapter\_number, verse\_number  
   FROM topics\_by\_word2  
   WHERE word\_nf \= ‘\<NF2\>’  
   AND language IN (\<list of language codes\>)

The \<list of language codes\> consists of the following:

1) A value of the “language” parameter of the current Bible module.  
2) Values from the “hyperlink\_languages” parameter of the current Bible module.  
3) If a word being looked up contains Greek alphabet characters (Unicode codepoints U+0380 \- U+03FF, U+1F00 \- U+1FFF) \- additionally the language codes ‘el’, ‘Original’.  
4) If a word being looked up contains Hebrew alphabet characters (Unicode codepoints U+0590 \- U+05FF, U+FB1D \- U+FB4F) \- additionally the language codes ‘iw’, ‘he’, ‘Original’.

### **Strong Numbers Lookup**

When looking up dictionary topics for a Strong’s number tapped by the user in a Bible module, MyBible performs a query using the following SQL statement:

The following SQL statement is used for this:

SELECT  
   word\_nf, topic, language, dictionary\_name, dictionary\_type,  
   book\_number, chapter\_number, verse\_number  
FROM topics\_by\_word1  
WHERE word\_nf \= ‘\<Strong’s number in lowercase’  
UNION  
SELECT  
   word\_nf, topic, language, dictionary\_name, dictionary\_type,  
   book\_number, chapter\_number, verse\_number  
FROM topics\_by\_word2  
WHERE word\_nf \= ‘\<Strong’s number in lowercase’

### **Word Cross References Lookup**

When looking up dictionary topics for a dictionary cross reference tapped by the user in a dictionary article, MyBible queries the TOPICS\_BY\_TOPIC view.

The following SQL statement is used for this:

SELECT \* FROM topics\_by\_topic  
WHERE topic \= ‘\<referenced topic with no changes\>’  
AND language IN (\<list of language codes\>)

The \<list of language codes\> is defined in the same way as for regular words lookup.

Example:

SELECT \* FROM topics\_by\_topic  
WHERE topic \= ’)iysHaq‎’  
AND language IN (‘Aramaic’)

### **Dictionary Lookup Algorithm**

Overall steps:

1) The user activates a hyperlink on a Bible word or on a Bible Strong’s number (usually by a double-tap, can be configured to a single-tap).

2) If the user has tapped a word with a (hidden) Strong’s number attached to it, MyBible obtains two words to look up by: a tapped word itself and a Strong’s number. Then:

   1) If the Lookup Mode is ‘Strong’, MyBible performs a lookup by a Strong’s number first, then, if no results found \- by a word.

   2) If the Lookup Mode is ‘Dictionaries’, MyBible performs a lookup by a word first, then, if no results found \- by a Strong’s number.

3) If the user has tapped a Strong’s number, MyBible performs a lookup by that Strong’s number only.

Lookup preparation:

1) MyBible checks whether the dictionaries need re-indexing, and if they do \- starts the process of their re-indexing.

Word lookup stages:

1) Execute the Stage 1 of the Regular Words Lookup (see above).

2) If the Stage 1 has not succeeded, execute the Stage 2 of the Regular Words Lookup (see above).

Lookup Algorithm:

1. If the algorithm is called for the first tapping of a word in a particular place then:

1) If the input word is a Strong’s number OR if the Lookup Mode is ‘Strong’:

   1) NF of an input word \-\> “Current Strong’s Lexicon” filter:

      * If Found: show the article, end of the search.

   2) If Found Many: NF of an input word \-\> “Current Strong’s Lexicon for Current Place” filter:

      * If Found: show the article, end of the search.

      * If Not Found: get the result of the step I.1.a) and process the following steps.

      * If Found Many:

        NF of an input  word \-\> "Any Dictionary” filter:

        1) If Found: end of the search

        2) If Found Many: show list, end of the search.	

2) If Not Found AND If the Current Dictionary is of the “concordance” type: NF of an input word \-\> "NF0 in Current Dictionary” filter:

   1) If Found: end of the search

   2) If Found Many: NF of an input word \-\> "Current Dictionary” filter: show list, end of the search.

3) If Not Found: NF of an input word \-\> "Current Dictionary for Current Place” filter:

   1) If Found: end of the search

   2) If Found Many, NF of an input word \-\> "Current Dictionary” filter: show list, end of the search.

4) If Not Found: NF of an input word \-\> "Current Dictionary for Default Topic” filter:

   1) If Found: end of the search

   2) If Found Many: NF of an input word \-\> "Current Dictionary” filter: show list, end of the search.

5) If Not Found: NF of an input word \-\> "Current Dictionary” filter:

   1) If Found: end of the search

   2) If Found Many: show list, end of the search.

6) NF of an input word \-\> "Any Dictionary” filter:

   1) If Found: end of the search

   2) If Found Many: show list, end of the search.

2. ELSE, if the the algorithm is called for a repeated tapping of a word in the same place, then NF of an input word \-\> "Any Dictionary” filter:

   3) If Found: end of the search.

   4) If Found Many: show list, end of the search.

### **Lookup Filters**

Each lookup filter converts an input of lookup results into an output list of filtered lookup results and returns one of the following values: Found, Found Many, Not Found.

In the filters described below, the statement ***“for the current Bible place”*** means that:

- There is a single record for the input word form where a Bible place attached to the word form is equal to the current Bible place

OR

- There is no record for the input word form where a Bible place attached to the word form is equal to the current Bible place, and at the same time there is a single record for the input word form where book number is 0\.

#### **NF0 in Current Dictionary**

MyBible looks for a topic in the current dictionary for which its NF0 matches NF0 of an input word: Input word \-\> dictionary topic.

#### **Current Dictionary for Current Place**

MyBible looks for an input word in the current dictionary for the current Bible place. Input word \+ Bible place \-\> standard form of a word \-\> dictionary topic.

#### **Current Dictionary for Default Topic**

MyBible looks for an input word in the current dictionary for a default topic. A default topic is a topic that corresponds to an input word and has no Bible place associated with it. Input word \+ no Bible place \-\> standard form of a word \-\> dictionary topic.

#### **Current Strong’s Lexicon for Current Place**

MyBible looks for an input word in the current Strong’s lexicon for the current Bible place. Input word \+ Bible place \-\> standard form of a word (the same Strong’s number in this case) \-\> lexicon topic.

#### **Current Dictionary**

MyBible looks for an input word in the current dictionary. Input word \-\> standard form of a word \-\> dictionary topic.

#### **Current Strong’s Lexicon**

MyBible looks for an input word in the current Strong’s lexicon. Input word \-\> standard form of a word (the same Strong’s number in this case)  \-\> lexicon topic.

#### **Any Dictionary for Current Place Plus Matching Topics in Concordance Dictionaries**

MyBible looks for an input word in all active dictionaries and lexicons for the current Bible place. Input word \+ Bible place \-\> standard form of a word \-\> dictionary topic. The filtered list also contains topics from dictionaries of the “concordance” type that match NF1 or NF2 of an input word: NF1(Input word) \-\> concordance dictionary topic, NF2(Input word) \-\> concordance dictionary topic.

#### **Any Dictionary**

MyBible looks for an input word in all active dictionaries and lexicons. Input word \-\> standard form of a word \-\> dictionary topic.

### **Dictionary Lookup Tables and Views**

This section provides details on how the dictionary lookup data (see the “Dictionary Lookup Data” section above) are organized.

#### **DICTIONARIES Table**

This table is created at the beginning of the dictionary lookup data generation process and helps in creating and updating of lookup data.

| Field name | Description |
| :---- | :---- |
| id | A dictionary identifier. An ID gets assigned to downloaded dictionaries as sequential numbers starting from 1\. Upon updating of the lookup data, IDs of remaining dictionaries are kept; added dictionaries obtain next not yet used numbers. |
| name | Dictionary abbreviation. |
| type | Same as TOPICS\_BY\_WORD1.dictionary\_type (see above). |
| language | Same as TOPICS\_BY\_WORD1.language (see above). |
| matching\_type | A value of this field is based on the “standard\_form\_matching\_type” parameter of a corresponding dictionary module; if the parameter is not defined for the dictionary, it is taken from a dictionary with abbreviation matching the language code of a corresponding dictionary: 1, if standard\_form\_matching\_type \= “normalized form 1” 2, if standard\_form\_matching\_type \= “normalized form 2” 3, if standard\_form\_matching\_type \= “exact” Otherwise (if a value of the “standard\_form\_matching\_type” parameter cannot be found), the value is 2\. |
| dictionary\_rows | The number of records in the DICTIONARY table of a corresponding dictionary, or 0 if the table is absent. |
| words\_rows | The number of records in the WORDS table of a corresponding dictionary, or 0 if the table is absent. |
| last\_modified | Modification timestamp of a corresponding dictionary file (a value returned by File.lastModified). |
| is\_changed | Indication that a dictionary has changed since the last generation of lookup data. It is set to 1, if: there is no such dictionary in the currently existing lookup data (including if there are not yet current lookup data) a value of any of the other fields (see above) in the currently existing lookup data does not match such a value calculated during the indexing being performed otherwise this field is set to 0\. |

CREATE TABLE dictionaries (  
    id NUMERIC NOT NULL,  
    name TEXT NOT NULL,  
    type TEXT NOT NULL,  
    language TEXT NOT NULL,  
    matching\_type NUMERIC NOT NULL,  
    dictionary\_rows NUMERIC NOT NULL,  
    words\_rows NUMERIC NOT NULL,  
    last\_modified NUMERIC NOT NULL,  
    is\_changed NUMERIC NOT NULL,  
    PRIMARY KEY (id));

#### **LOOKUP\_WORDS Table**

This table contains normalized word forms from the WORDS table and normalized forms of topics from the DICTIONARY table, both with a correspondence to dictionary topics \- for all downloaded dictionaries.

| Field name | Description |
| :---- | :---- |
| word\_nf1 | For data from the WORDS table: NF1(WORDS.variation) For data from the DICTIONARY table: NF1(DICTIONARY.topic) |
| word\_nf2 | For data from the WORDS table: If NF2(WORDS.variation) does not match matches NF1(WORDS.variation): NF2(WORDS.variation). Otherwise: empty string (‘’). For data from the DICTIONARY table: If NF2(DICTIONARY.topic) does not match matches NF1(DICTIONARY.topic): NF2(DICTIONARY.topic). Otherwise: empty string (‘’). |
| topic\_hash1 | For data from the WORDS table: If matching\_type \= 3: String.hashCode(WORDS.standard\_form). If matching\_type \= 1: String.hashCode(NF1(WORDS.standard\_form)). If matching\_type \= 2 and dictionary\_rows \= 0: String.hashCode(NF1(WORDS.standard\_form)). Otherwise: 0\. For data from the DICTIONARY table: If matching\_type \= 3: String.hashCode(DICTIONARY.topic). If matching\_type \= 1: String.hashCode(NF1(DICTIONARY.topic)). Otherwise: 0\. |
| topic\_hash2 | For data from the WORDS table: If matching\_type \= 1: String.hashCode(NF2(WORDS.standard\_form)), but if it equals to topic\_hash1 then 0\. If matching\_type \= 2: If dictionary\_rows \> 0: String.hashCode(NF2(WORDS.standard\_form)). Else: String.hashCode(NF2(WORDS.standard\_form)), but if it equals to topic\_hash1 then 0\. Otherwise: 0\. For tata from the DICTIONARY table: If matching\_type \= 1: String.hashCode(NF2(DICTIONARY.topic)), but if it equals to topic\_hash1 then 0\. If matching\_type \= 2: String.hashCode(NF2(DICTIONARY.topic)). Otherwise: 0\. |
| book\_number | Content of the WORDS.book\_number, or 0\. |
| chapter\_number | Content of the WORDS.chapter\_number, or 0\. |
| verse\_number | Content of the WORDS.verse\_number, or 0\. |
| source\_dictionary\_id | Dictionary identifier assigned during the first creation of the lookup (DICTIONARY.id).  |
| target\_dictionary\_id | Same as source\_dictionary\_id, if dictionary\_rows \> 0 (a local dictionary), otherwise 0 (a global dictionary). |

CREATE TABLE lookup\_words (  
    word\_nf1 TEXT NOT NULL DEFAULT '',  
    word\_nf2 TEXT NOT NULL DEFAULT '',  
    topic\_hash1 NUMERIC NOT NULL DEFAULT 0,  
    topic\_hash2 NUMERIC NOT NULL DEFAULT 0,  
     
    book\_number NUMERIC NOT NULL DEFAULT 0,  
    chapter\_number NUMERIC NOT NULL DEFAULT 0,  
    verse\_number NUMERIC NOT NULL DEFAULT 0,  
    source\_dictionary\_id NUMERIC NOT NULL DEFAULT 0,  
    target\_dictionary\_id NUMERIC NOT NULL DEFAULT 0\)

CREATE INDEX lookup\_words\_word\_nf1 ON lookup\_words (word\_nf1)

CREATE INDEX lookup\_words\_word\_nf2 ON lookup\_words (word\_nf2)

#### **LOOKUP\_TOPICS Table**

This table contains information for dictionary topics from all downloaded dictionaries, prepared for quick matching of topics and word forms on a selection/view.

| Field name | Description |
| :---- | :---- |
| topic | Value of the DICTIONARY.topic field (with no changes). |
| topic\_nf2 | NF2(DICTIONARY.topic) |
| topic\_hash | String.hashCode() applied to a normalized form of DICTIONARY.topic. The normalized form to be used for each particular dictionary is chosen based upon the DICTIONARIES.matching\_type for a corresponding dictionary. |
| dictionary\_id | A value of DICTIONARIES.id for a corresponding dictionary. |

CREATE TABLE lookup\_topics (  
    topic TEXT NOT NULL DEFAULT '',  
    topic\_hash NUMERIC NOT NULL DEFAULT 0,  
    dictionary\_id NUMERIC NOT NULL DEFAULT 0);

CREATE INDEX lookup\_topics\_topic\_hash ON lookup\_topics (topic\_hash)

CREATE INDEX lookup\_topics\_topic ON lookup\_topics (topic)

#### **LOOKUP\_REFERENCES Table**

This is a table that contains references from dictionary topics to Bible verses, to support the “References to selected verse from active dictionaries” functionality. See also the INFO.informative\_references\_to\_verses parameter of a dictionary module.

CREATE TABLE lookup\_references (topic TEXT, book\_number NUMERIC, chapter\_number NUMERIC, verse\_number NUMERIC, dictionary\_id NUMERIC)

CREATE INDEX lookup\_references\_index ON lookup\_references (book\_number, chapter\_number, verse\_number)

| Field name | Description |
| :---- | :---- |
| topic | A dictionary topic, as it is specified in the DICTIONARY table. |
| book\_number | Bible book referenced from the specified topic. |
| chapter\_number | Bible chapter referenced from the specified topic. |
| verse\_number | Bible verse referenced from the specified topic. |
| dictionary\_id | A value of DICTIONARIES.id for a corresponding dictionary. |

#### **TOPICS\_BY\_WORD1 View**

This is a view for searching word forms by NF1.

CREATE VIEW topics\_by\_word1 AS SELECT  
    w.word\_nf1 AS word\_nf,  
    t.topic AS topic,  
    d.language AS language,  
    d.name AS dictionary\_name,  
    d.type AS dictionary\_type,  
    d.matching\_type AS dictionary\_matching\_type,  
    w.book\_number AS book\_number,  
    w.chapter\_number AS chapter\_number,  
    w.verse\_number AS verse\_number  
FROM  
    lookup\_words w, lookup\_topics t, dictionaries d  
WHERE  
    t.topic\_hash IN (w.topic\_hash1, w.topic\_hash2)  
    AND w.target\_dictionary\_id IN (t.dictionary\_id, 0\)  
    AND d.id \= t.dictionary\_id;

#### **TOPICS\_BY\_WORD2 View**

This is a view for searching word forms by NF2.

CREATE VIEW topics\_by\_word2 AS   
SELECT  
    w.word\_nf2 AS word\_nf,  
    t.topic AS topic,  
    d.language AS language,  
    d.name AS dictionary\_name,  
    d.type AS dictionary\_type,  
    d.matching\_type AS dictionary\_matching\_type,  
    w.book\_number AS book\_number,  
    w.chapter\_number AS chapter\_number,  
    w.verse\_number AS verse\_number  
FROM  
    lookup\_words w, lookup\_topics t, dictionaries d  
WHERE  
    t.topic\_hash IN (w.topic\_hash1, w.topic\_hash2)  
    AND w.target\_dictionary\_id IN (t.dictionary\_id, 0\)  
    AND d.id \= t.dictionary\_id;

#### **TOPICS\_BY\_TOPIC View**

CREATE VIEW topics\_by\_topic AS  
SELECT  
    t.rowid AS \_id,   
    t.topic AS topic,  
    t.topic\_nf2 AS topic\_nf2,  
    d.language AS language,  
    d.name AS dictionary\_name,  
    d.type AS dictionary\_type  
FROM   
    lookup\_topics t, dictionaries d  
WHERE  
    d.id \= t.dictionary\_id;

### **Dictionary Lookup Data Generation**

This section describes how MyBible fills the dictionary lookup tables (see the “Dictionary Lookup Tables and Views” section above) based upon the downloaded dictionaries. The described approach to generating of dictionary lookup data is a result of a thorough investigation having purposes of (1) minimizing the time needed for dictionaries indexing and re-indexing, and (2) minimizing a space used on a device’s flash for lookup structures.

1) Open a current lookup database.

2) Create a new lookup database.

3) Create create the DICTIONARIES table in the new lookup database:

   1) enumerate downloaded dictionaries and define/set values for all the fields in the DICTIONARIES table (except for the is\_changed field which will be updated later, see below)

   2) reuse dictionary IDs from the current lookup database

   3) calculate and set the is\_changed value according to the description of this field in the DICTIONARIES table description above

4) For each changed dictionary (is\_changed \= 1), index the WORDS table into the LOOKUP\_WORDS table.

   1) If a dictionary contains the LOOKUP\_WORDS table, copy its rows into the common LOOKUP\_WORDS table, with the ID of a dictionary being processed sent to both source\_dictionary\_id and target\_dictionary\_id fields.

   2) Otherwise (i.e. if there is no LOOKUP\_WORDS table in the dictionary), process all records from the WORDS table \- see the LOOKUP\_WORDS table description.

      1) Skip records having variation \= standard\_form AND book\_number \= 0

      2) Skip records having NF1(variation) \= ‘’

5) For each changed dictionary (is\_changed \= 1), index the DICTIONARY table into the LOOKUP\_WORDS and LOOKUP\_TOPICS tables.

   1) If a dictionary contains the LOOKUP\_TOPICS table, copy its rows into the common LOOKUP\_TOPICS table, with the ID of a dictionary being processed sent to the dictionary\_id field.

   2) Otherwise (i.e. if there is no LOOKUP\_TOPICS table in the dictionary), process all records from the DICTIONARY table:

      1) Insert a record into LOOKUP\_TOPICS \- see the table description for details.

      2) Insert a record into LOOKUP\_WORDS \- see the table description for details.

6) For all unchanged dictionaries (is\_changed \= 0\) copy records from the current lookup database to the new lookup database:

   INSERT INTO lookup\_words (  
       word\_nf1, word\_nf2, topic\_hash1, topic\_hash2,,  
       book\_number, chapter\_number, verse\_number,  
       source\_dictionary\_id, target\_dictionary\_id)  
   SELECT  
       word\_nf1, word\_nf2, topic\_hash1, topic\_hash2,,  
       book\_number, chapter\_number, verse\_number,  
       source\_dictionary\_id, target\_dictionary\_id  
   FROM  
       current\_lookup.lookup\_words w  
   WHERE  
       w.source\_dictionary\_id  
       IN (SELECT id FROM dictionaries WHERE is\_changed \= 0);

   INSERT INTO lookup\_topics (topic, topic\_hash, dictionary\_id)  
   SELECT  
       topic, topic\_hash, dictionary\_id  
   FROM  
       current\_lookup.lookup\_topics t  
   WHERE  
       t.dictionary\_id IN (SELECT id FROM dictionaries WHERE is\_changed \= 0);

   INSERT INTO lookup\_references (  
       topic, book\_number, chapter\_number, verse\_number, dictionary\_id)  
   SELECT  
      topic, book\_number, chapter\_number, verse\_number, dictionary\_id  
   FROM  
       current\_lookup.lookup\_references r  
   WHERE  
      r.dictionary\_id IN (SELECT id FROM dictionaries WHERE is\_changed \= 0\)

   

7) Create table indexes and views.

8) Replace the current lookup database with the new lookup database, deleting the old one.

# 

# **Subheadings Module**

A subheadings module, once downloaded, enables the user to see subheadings from it in every downloaded Bible module in the same language as the subheadings language. As an option, the user can also allow showing of the subheadings for any Bible module, no matter in which language.

## **INFO Table**

There are the following subheadings configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| font\_size | A font size for the subheadings, in screen density-dependent pixels. Can be an absolute number or a number relative to the user-configurable Bible font size. To specify a relative font size, use “+” or “-” at the beginning, e.g. “+1”, “-2”. |
| font\_bold | An indication that subheadings from this module shall be displayed in a bold font. Can be “true” or “false”, the default is “false”. |
| font\_italic | An indication that subheadings from this module shall be displayed in an italic font. Can be “true” or “false”, the default is “false”. |
| font\_color\_day | A color for the subheadings text in the regular (day) reading mode. The color is specified in the standard Android notation: \#rrggbb or \#aarrggbb. rr, gg, bb are two-digit hexadecimal values of the red, green, and blue color components. aa (if used) is a two-digit hexadecimal value of the alpha channel (opacity), with ff meaning fully opaque and 00 meaning fully transparent. |
| font\_color\_night | A color for the subheadings text in the night reading mode. |
| right\_to\_left | An indication that this module uses right-to-left writing. Can be “true” or “false”, default is “false”; shall be set to “true” for Hebrew and Arabic Bible translations. |

## 

## **SUBHEADINGS Table**

This table contains subheadings data.

CREATE TABLE subheadings (book\_number NUMERIC, chapter NUMERIC, verse NUMERIC, order\_if\_several NUMERIC, subheading TEXT)

CREATE UNIQUE INDEX subheadings\_index ON subheadings(book\_number,  chapter, verse, order\_if\_several)

| Field name | Description |
| :---- | :---- |
| book\_number | A reference to one of the predefined book numbers \- see the Bible module description. |
| chapter\_number | A reference to a chapter of the specified book. |
| verse | A verse number in the specified Bible chapter this subheading shall be shown before. |
| order\_if\_several | An order of subheadings specified for the same verse, if there are several of them. Can be NULL. |
| subheading | A subheading text. A plain text is assumed here. However, a hyperlink (a “cross reference”) can be marked in a subheading with a pair of tags, \<x\> … \</x\>. The text within these tags is assumed to represent a book number, a chapter number, and a verse number of a hyperlink target. Any format of a hyperlink target described for a Dictionary module, dictionary.definition field, is acceptable here. Upon its activation, a hyperlink will transition to the very first verse covered by the hyperlink target. Example: This is a sample subheading 1 with a hyperlink to \<x\>480 3:5\</x\> and also to \<x\>500 1:3-2:10\</x\>. It will be shown as: This is a sample subheading 1 with a hyperlink to Mar 3:5 and also to John  1:3-2:10. The first hyperlink here will transition to Mar 3:5, the second \- to John 1:3. |

# 

# **Cross References Module**

A cross references module contains cross references that are additional to the MyBible’s built-in cross references, to be shown in a separate window for a particular Bible verse.

## **INFO Table**

There are the following cross references configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| description\_LL | A cross references description in a language, coded by two letters at the end of the configuration parameter name (represented by “LL”). Usually there are the following configuration parameters:    description\_de (German)    description\_ru (Russian)    description\_uk (Ukrainian) and some others. If a description for a particular language is not specified, a value of the “description” configuration parameter is used (which is usually English). |
| requires\_reverse\_processing | A boolean indication that cross references in this module for a particular verse becomes complete only after combining the references “from \-\> to” and “to \-\> from” and removing duplicate references after this. A default value is false. |

## **CROSS\_REFERENCES Table**

This table contains cross references of Bible verses.

CREATE TABLE cross\_references (book NUMERIC, chapter NUMERIC, verse NUMERIC, verse\_end NUMERIC, book\_to NUMERIC, chapter\_to NUMERIC, verse\_to\_start NUMERIC, verse\_to\_end NUMERIC, votes NUMERIC)

CREATE INDEX book\_and\_chapter ON cross\_references(book, chapter)

CREATE INDEX book\_and\_chapter\_to ON cross\_references(book\_to, chapter\_to)  
Note: this index is not needed if the requires\_reverse\_processing configuration parameter for a module is set to false or not specified.

~~CREATE INDEX book\_chapter\_verse ON cross\_references(book, chapter, verse)~~

| Field name | Description |
| :---- | :---- |
| book | A Bible book a cross reference is defined for. This is a reference to one of the predefined book numbers \- see the Bible module description. |
| chapter | A chapter of the specified book a cross reference is defined for. |
| verse | A verse of the specified Bible chapter a cross reference is defined for. |
| verse\_end | An ending verse of a verses range of the specified Bible chapter a cross reference is defined for. Shall be set to 0 or null if a cross reference goes to a single verse. |
| book\_to | A Bible book a cross reference goes to. |
| chapter\_to | A chapter of the specified Bible book a cross reference goes to. |
| verse\_to\_start | A beginning verse of a verses range of the specified Bible chapter a cross reference goes to. |
| verse\_to\_end | An ending verse of a verses range of the specified Bible chapter a cross reference goes to. Shall be set to 0 if a cross reference goes to a single verse. |
| votes | The number of votes (by cross references compilation team members) for relevance of this particular cross reference. Used in MyBible for sorting of cross references by relevance. |

# **Commentaries Module**

## **INFO Table**

There are the following Bible commentaries configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| is\_footnotes | An indication that the module contains footnotes for a particular (same abbreviation) Bible module. Allowed values are "true" and "false" (this is the default value). This indication influences the way MyBible shows articles from commentary modules. For footnotes, an applicable Bible position information is shown at the beginning of the first line of an article, with a footnote marker, if provided and applicable. For non-footnotes, an applicable Bible position information is shown on a separate line before the article text, without a footnote marker (so footnote markers are ignored for commentary modules not having the "is\_footnotes" configuration parameter set to "true"). |

## **COMMENTARIES Table**

This table contains commentaries texts.

CREATE TABLE commentaries (book\_number NUMERIC, chapter\_number\_from NUMERIC, verse\_number\_from NUMERIC, chapter\_number\_to NUMERIC, verse\_number\_to NUMERIC, is\_preceding NUMERIC, marker TEXT, text TEXT )

Note: the "marker" field is optional and may be omitted.

CREATE INDEX commentaries\_index on commentaries(book\_number, chapter\_number\_from, verse\_number\_from)

| Field name | Description |
| :---- | :---- |
| book\_number | A book number a commentaries text is relevant to. This is a reference to one of the predefined book numbers \- see the Bible module description. |
| chapter\_number\_from | A chapter number of a starting place in the Bible a commentaries text is relevant to. If this value is 0, a commentaries text is relevant to the entire book. Shall not be null. |
| verse\_number\_from | A verse number of a starting place in the Bible a commentaries text is relevant to. If chapter\_number\_from is 0, this value is ignored. |
| chapter\_number\_to | A chapter number of an ending place in the Bible a commentaries text is relevant to. If chapter\_number\_from is 0, this value is ignored. If this value is null, a commentary is relevant to the end of the chapter\_number\_from. Otherwise a commentaries text is relevant to chapter\_number\_to:verse\_number\_to, inclusively. This field shall be empty if  “is\_footnotes” configuration parameter is “true”. |
| verse\_number\_to | A verse number of an ending place in the Bible a commentaries text is relevant to. If chapter\_number\_from is 0, this value is ignored. If verse\_number\_to is null and chapter\_number\_to is not null, a commentaries text is relevant to the end of chapter\_number\_to. If both chapter\_number\_to and verse\_number\_to are null, a commentaries text is only applicable to chapter\_number\_from:verse\_number\_from. If both chapter\_number\_to and verse\_number\_to are NOT null, a commentaries text is relevant to chapter\_number\_to:verse\_number\_to, inclusively. |
| is\_preceding | An optional field: an indication that a link to this commentary in the Bible text shall at the beginning of a range of verses defined by the \*\_from and \*\_to fields. If this field is omitted, or is null, or contains 0, a link to this commentary in the Bible text will be shown at the end of the commented range. |
| marker | This is an optional field containing a footnote marker. A corresponding (same abbreviation) Bible module shall have the same footnote marker in the same book/chapter/verse for MyBible to connect together a footnote to a footnote marker. If there are several footnotes for the same verse, they must have different markers. MyBible processes this field only if the “is\_footnotes” configuration parameter is “true”. |
| text | A commentary article, in HTML form, as defined by the "HTML Content" section above. |

## **BOOKS Table**

This is an optional table that provides for showing in references of book abbreviations as they are defined in the commentary module, and also for showing of book abbreviations in references to Bible books that are absent in the current Bible translation.

CREATE TABLE books (book\_number NUMERIC, short\_name TEXT)

| Field name | Description |
| :---- | :---- |
| book\_number | A book number, see the "Books reference" section for the Bible Module. |
| short\_name | A book abbreviation. |

# 

# **Reading Plan Module**

A reading plan module is a language-neutral module, because it contains no texts but just book/chapter/verse numbers. However, a reading plan module does contain own description in several languages, so that it is better presented to a user.

## **INFO Table**

There are the following reading plan configuration parameters in addition to the common configuration parameters (see the General section).

| Item name | Description |
| :---- | :---- |
| description\_LL | A reading plan description in a language, coded by two letters at the end of the configuration parameter name (represented by “LL”). Usually for a reading plan there are the following configuration parameters:    description\_de (German)    description\_ru (Russian)    description\_uk (Ukrainian) and some others. If a description for a particular language is not specified, a value of the “description” configuration parameter is used (which is usually English). |

## **READING\_PLAN Table**

This table contains readin plan items.

CREATE TABLE reading\_plan (day NUMERIC, evening NUMERIC, item NUMERIC, book\_number NUMERIC, start\_chapter NUMERIC, start\_verse NUMERIC, end\_chapter NUMERIC, end\_verse NUMERIC)

CREATE INDEX reading\_plan\_index on reading\_plan (day, evening, item)

| Field name | Description |
| :---- | :---- |
| day | Reading plan day number, starting from 1\. A maximum number in this field defines a reading plan duration in days. |
| evening | If equals to 1, indicates an evening reading portion. MyBible used to have different colors of buttons for morning and evening reading portions in the “Reading plans” window. This is not the case anymore, but several plans still use “0” and “1” in this column, for historical reasons. Usually “0” in this field is a good choice. |
| item | Reading plan item number for a specified combination of “day” and “evening”. Reading plan items for a day get sorted by this value in MyBible. |
| book\_number | Bible book number a reading plan item points to. |
| start\_chapter | Chapter number where a Bible reading plan item starts. |
| start\_verse | Verse number where a Bible reading plan item starts. If empty, the first verse is assumed. |
| end\_chapter | Chapter number where a Bible reading plan item ends. Cannot be empty; shall be equal to start\_chapter if a reading plan item covers a single Bible chapter. |
| end\_verse | Verse number where a Bible reading plan item ends. If empty, the last verse of a chapter pointed by end\_chapter is assumed. |

# **Devotions Module**

## **INFO Table**

There are no devotions-specific configuration parameters in addition to the common configuration parameters (see the General section).

## **DEVOTIONS Table**

This table contains devotions texts.

CREATE TABLE devotions (day NUMERIC, devotion TEXT)

CREATE UNIQUE INDEX devotions\_index ON devotions (day ASC)

| Field name | Description |
| :---- | :---- |
| day | Devotions series day number, starting from 1\. |
| devotion | A devotion article, in HTML form, as defined by the "HTML Content" section above.  |

# **Graphe Extensions to the MyBible Format**

Graphe uses the MyBible SQLite3 format as its internal verse storage. During import (from MySword, theWord, or other sources), Graphe converts module-specific markup into the standard MyBible tags listed above plus the additional tags documented below. These extensions are **only present in Graphe's converted modules** and are not part of the upstream MyBible specification.

## **Tag Format Conventions**

Graphe modules use two closing-tag styles:

- **HTML-style** `</tag>` — used by standard MyBible tags and some Graphe tags: `<S>…</S>`, `<i>…</i>`, `<f>…</f>`, `<m>…</m>`, `<l>…</l>`, `<J>…</J>`, `<h>…</h>`.
- **Case-paired** `<Tag>…<tag>` — uppercase opens, lowercase closes. Used for interlinear extensions originating from the theWord format: `<E>…<e>`, `<O>…<o>`, `<T>…<t>`, `<X>…<x>`, and their language-specific variants.

Case-paired `<e>` (closing `<E>`) is consumed **before** standard `<e>…</e>` emphasis processing, so there is no conflict between the two styles. The self-closing `<pb/>` tag is also supported for paragraph breaks.

## **Interlinear Word Unit Grammar**

A complete interlinear word unit has the following structure:

```
WordUnit       = <E>text<e> [OrigTag] [TranslitTag] [StrongsTags] [ExtAnnotations]
OrigTag        = <O>text<o> | <OG>text<og> | <OH>text<oh>
TranslitTag    = <T>text<t> | <TG>text<tg> | <TH>text<th>
StrongsTags    = (<S>number</S> [<m>morph</m>] [<l>lemma</l>])+
ExtAnnotations = <X>key=val|key=val|…<x>
```

All components after `<E>…<e>` are optional. A minimal word unit is just `<E>word<e>`. A typical annotated unit:

```
<E>Βίβλος<e><T>Biblos<t><S>976</S><m>N-NSF</m><l>βίβλος</l>
```

## **Case-Paired Interlinear Tags**

| Tag | Description |
| :---- | :---- |
| \<E\>…\<e\> | The main word form displayed at the top of a stacked interlinear annotation. For Greek interlinear modules this is the Greek word; for reverse interlinear modules it is the translation. |
| \<O\>…\<o\> | Original-language word associated with the preceding \<E\> word. Displayed below the main word in the annotation stack. Variants \<OG\>…\<og\> and \<OH\>…\<oh\> may be used to indicate Greek or Hebrew origin explicitly. |
| \<T\>…\<t\> | Transliteration of the original-language word. Displayed below the original word in the annotation stack. Variants \<TG\>…\<tg\> and \<TH\>…\<th\> may be used for Greek or Hebrew. **Note:** this is distinct from the standard MyBible \<t\>…\</t\> poetry/indent tag, which uses an HTML-style closing tag with a forward slash. |

## **Strong's Number Format**

The `<S>…</S>` tag carries a Strong's reference number. Its content format varies by source:

- **Converted modules** (MyBible SQLite3 produced by the theWord or MySword converters): `<S>` content is **digits only** (no H/G prefix). The Hebrew/Greek prefix is inferred at render time from the book number (OT books \< 470 → H, NT books ≥ 470 → G), or overridden by the `strong_numbers_prefix` field in the `info` table.
- **Directly-loaded theWord modules** (via `theword-bible-provider`): `<S>` content may include the H/G prefix (e.g. `H1234`, `G5678`), along with `morph` and `lemma` attributes on the tag itself: `<S morph="V-AAI-3S" lemma="λέγω">G3004</S>`. The renderer normalizes both formats.

## **Lemma Tag**

| Tag | Description |
| :---- | :---- |
| \<l\>…\</l\> | Lemma (dictionary form) associated with a preceding Strong's number. Always follows the \<m\> morphology tag (if present), which always follows \<S\>…\</S\>. Contains the dictionary/lemma form (e.g. `βίβλος` for the inflected `Βίβλος`). Not part of the upstream MyBible spec. Example: \<S\>976\</S\>\<m\>N-NSF\</m\>\<l\>βίβλος\</l\> |

## **Extended Annotations Tag**

| Tag | Description |
| :---- | :---- |
| \<X\>…\<x\> | Extended annotation data for an interlinear word, encoded as pipe-delimited key=value pairs. Placed after all other tags for a word unit. This tag is produced during import of modules that carry richer linguistic data (e.g. OGNTe). |

### Supported keys

| Key | Description | Example |
| :---- | :---- | :---- |
| pr | Pronunciation (phonetic transcription) | pr=viyvlos |
| pbr | Portuguese translation/gloss | pbr=Livro |
| og | English translation/gloss | og=book |
| es | Spanish translation/gloss | es=Libro |
| ln | Louw-Nida lexical domain reference(s), comma-separated | ln=33.38 |
| gk | Goodrick-Kohlenberger number | gk=1047 |

### Example

A fully annotated word unit from the OGNTe module (Matthew 1:1, "Βίβλος"):

```
<E>Βίβλος<e><T>Biblos<t><S>976</S><m>N-NSF</m><l>βίβλος</l><X>pr=viyvlos|pbr=Livro|es=Libro|og=book|ln=33.38|gk=1047<x>
```

Graphe renders this as a stacked annotation:

```
Βίβλος           ← main Greek word (from <E>)
  G976           ← Strong's number
  Biblos         ← transliteration (from <T>)
  viyvlos        ← pronunciation (pr)
  Livro          ← Portuguese gloss (pbr)
  book           ← English gloss (og)
  Libro          ← Spanish gloss (es)
  LN 33.38       ← Louw-Nida reference (ln)
  GK 1047        ← Goodrick-Kohlenberger number (gk)
```

The \<X\> key set is open-ended — additional keys may be added in future imports without requiring renderer changes (unknown keys are silently ignored).

