"use strict";

/**
 * @name PromisedResolve
 * @type {Function}
 * @param {string} dir
 * @param {string} request
 * @returns Promise
 */

/**
 * @name Importer
 * @type {Function}
 * @param {string} url
 * @param {string} prev
 * @param {Function<Error, string>} done
 */

const debug = require("debug");
const chalk = require("chalk");
const path = require("path");
const tail = require("lodash.tail");
const importsToResolve = require("./importsToResolve");

const matchCss = /\.css$/;


// Start wiwo
const NO_GLOB/*: boolean */ = (function(rawValue){
    let result = true;
    if (rawValue === '0' || rawValue.toLowerCase() === 'false'){
        result = false;
    } else {
        result = true;
    }
    return result;
})(process.env.NO_GLOB || '');


function wiwoCheckGlobs(foundGlobs){
    if (foundGlobs && foundGlobs.size){

        console.warn(chalk.yellow(`(@wiwo/sass-loader) (warning only) found globs in project; (set NO_GLOB=0 to ignore for now)`));
        foundGlobs.forEach(( [url, prev] ) => {
            console.warn(`  glob in ${chalk.red(url)} (imported from ${prev})`);
        });

        if (NO_GLOB){
            throw new Error(`(@wiwo/sass-loader) globs must be removed`);
        }
    }
}
// End wiwo


/**
 * Returns an importer that uses webpack's resolving algorithm.
 *
 * It's important that the returned function has the correct number of arguments
 * (based on whether the call is sync or async) because otherwise node-sass doesn't exit.
 *
 * @param {string} resourcePath
 * @param {PromisedResolve} resolve
 * @param {Function<string>} addNormalizedDependency
 * @returns {Importer}
 */
function webpackImporter(resourcePath, resolve, addNormalizedDependency) {
    let lg = debug('SassLoader:importer');

    // The sass compiler doesn't like backslashes so normalise '\' to '/'
    resourcePath = resourcePath.replace(/\\/g, '/');

    let foundGlobs = new Map();

    function dirContextFrom(fileContext) {
        return path.dirname(
            // The first file is 'stdin' when we're using the data option
            fileContext === "stdin" ? resourcePath : fileContext
        );
    }

    function startResolving(dir, importsToResolve) {
        // debugger;
        // console.log(`\n(startResolving)\n${dir}\n${importsToResolve[0]}\n`);

        return importsToResolve.length === 0 ?
            Promise.reject(`no more importsToResolve`) :
            resolve(dir, importsToResolve[0])
                .then(
                    resolvedFile => {

                        // console.log(chalk.green('\n\n!!!success: ', resolvedFile, '\n\n'));

                        // Add the resolvedFilename as dependency. Although we're also using stats.includedFiles, this might come
                        // in handy when an error occurs. In this case, we don't get stats.includedFiles from node-sass.
                        addNormalizedDependency(resolvedFile);


                        return {
                            // By removing the CSS file extension, we trigger node-sass to include the CSS file instead of just linking it.
                            file: resolvedFile.replace(matchCss, "")
                        };
                    },
                    () => startResolving(
                        dir,
                        tail(importsToResolve)
                    )
                );
    }


    // Custom wiwo behaviour
    function wiwoResolve(url, prev){
        let promise;
        if (glob.hasMagic(url)){

            let globKey = resourcePath+''+url;
            if (!foundGlobs.has(globKey)){
                foundGlobs.set(globKey, [url, prev]);
            }

            promise = resolveGlobImport(url, prev);
        } else {
            promise = resolveSingleImport(url, prev)
        }
        return promise;
    }


    // starts with ./ or ../
    const startsRelativeRE = /^\.?\.\//;

    function resolveSingleImport(url, prev){

        // Check if the leading directory is a known project and prepend '~@'
        if (startsRelativeRE.test(url)){
            // all good
        } else {
            // Try to resolve to a known module with ~# prefix.
            url = pathToKnownModule(url);
        }

        let possibleImports = importsToResolve(url);

        // console.log(`possibleImports=\n${ possibleImports.join('\n') }\n\n`);

        return startResolving(
            dirContextFrom(prev),
            possibleImports
        );
    }


    const glob = require('glob');
    const fs = require("fs");
    const _path = path.posix;

    let __INDEX = 0;

    function resolveGlobImport(url, prev) {
        return Promise.resolve(_resolveGlobImport(url, prev));
    }


    function _resolveGlobImport(url, prev){

        let result;

        let basePrev = dirContextFrom(prev);
        const globPath = path.dirname(url);

        let resolveGlobPath = globPath;
        let isModule = false;

        let globResult;

        // starts with ./ or ../

        // debugger;

        if (startsRelativeRE.test(globPath)){
            // Leave as-is
        } else {
            let relPath = _path.join(basePrev, globPath);

            // Not an explicitly relative path
            // console.log(chalk.yellow(`trying: ${relPath}`));

            if (fs.existsSync(relPath)){
                // Resolve glob against relative path
                resolveGlobPath = './'+globPath;
                isModule = true;

                // console.log(chalk.green('Matched valid path'));
            } else {
                /**
                 * Get the first part of the globPath and see if it matches
                 * a known/configured bower module.
                 */
                resolveGlobPath = prependDepPath(globPath);
            }
        }


        let globContext = _path.join(basePrev, resolveGlobPath);
        if (startsRelativeRE.test(resolveGlobPath)){
            // Resolve pattern relative to `basePrev`
            globResult = glob.sync(
                '*.scss',
                {
                    cwd: globContext,
                    nodir: true,
                }
            );

            // Output paths prefixed with './'
            globResult = globResult.map((p) => _path.join(globContext, p));
        } else {
            // resolve to module directory first,
            // then make relative to that dir

            /*
            @import "test/*" =>

                ./test/*
                ~#test/*

            */

            result = Promise.reject('Not implemented yet');
        }

        if (globResult && globResult.length){

            // TODO: Only include all this detail in a debug mode - see if that makes things quicker?
            let contents = []
                .concat(
                    '/*',
                    `!!!START="${url}"@@@`,
                    `!(PARENT="${prev}")`,
                    `dir="${basePrev}" pattern="${url}"`,
                    globResult.map(p => `   ├"${p}"`),
                    '*/'
                )
                .concat(
                    globResult.map(p => `@import "${p}";`),
                    `/*\n!!!END   "${url}"@@@\n*/`
                ).join('\n');

            // Resolve with a "virtual file"
            // let vPath = url.replace(/\*/g, 'glob');
            let vPath = url;
            let virtualFile = {
                file: `${globContext}/${vPath}/${__INDEX}`,
                contents: contents
            };
            result = virtualFile;
            __INDEX++;

            lg(`\nvirtual glob file="${virtualFile.file}"\n${virtualFile.contents}`);

        } else {
            result = Promise.reject(`no globResults`);
            // console.log(`\n\nresult=\n${globResult}`);
        }

        return result;
    }


    // Check if any path should resolve to one of our "known" modules
    function getDependencyEntry(candidatePath){
        // Just return unchanged if it doesn't match.
        let result = candidatePath;

        // Test base directory against our "known" modules
        // e.g. "wiwo-repayment-widget"
        const deps = getBowerDeps();

        /**
         * Get the first part of the globPath and see if it matches
         * a known/configured bower module.
         */
        // TODO: Split off any '~@' as well

        let depId = candidatePath.split('/', 1)[0] || '';
        return deps[depId];
    }


    function prependDepPath(candidatePath){
        let result = candidatePath;

        let depEntry = getDependencyEntry(candidatePath);
        if (depEntry){
            // If it does then resolve the glob against that module path.
            let depPath = depEntry.path;
            result = path.join(depPath, candidatePath);
        }

        return result;
    }


    function pathToKnownModule(candidatePath){
        let result = candidatePath;

        let depEntry = getDependencyEntry(candidatePath);
        if (depEntry){
            // Prepend our special module chars
            result = '~@' + candidatePath;
        }

        return result;
    }
    // End of custom wiwo


    return (url, prev, done) => {
        lg(chalk.cyan(`\nurl=${ url }\nprev=${ prev }`));

        wiwoResolve(url, prev)
         // Catch all resolving errors, return the original file and pass responsibility back to other custom importers
            .catch((err) => {
                return { file: url };
            })
            .then((result) => {

                // wiwo: Log warnings if we've found globs
                wiwoCheckGlobs(foundGlobs);

                done(result);
            });
    };
}

/*
wiwo
*/
const WiwoDep = require("@wiwo/wiwo-dependencies-bower").WiWoDependencies;
let _deps;
function getBowerDeps(){
    if (!_deps){
        // For now assume `bower.json` in cwd
        _deps = WiwoDep.getEntriesPlusDefaults('bower.json');
    }
    return _deps;
}
// End of Wiwo


module.exports = webpackImporter;
