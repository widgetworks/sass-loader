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

const chalk = require("chalk");
const path = require("path");
const tail = require("lodash.tail");
const importsToResolve = require("./importsToResolve");

const matchCss = /\.css$/;

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
    function dirContextFrom(fileContext) {
        return path.dirname(
            // The first file is 'stdin' when we're using the data option
            fileContext === "stdin" ? resourcePath : fileContext
        );
    }

    function startResolving(dir, importsToResolve) {
        // debugger;
        console.log(`\n(startResolving)\n${dir}\n${importsToResolve[0]}\n`);
        
        return importsToResolve.length === 0 ?
            Promise.reject() :
            resolve(dir, importsToResolve[0])
                .then(
                    resolvedFile => {
                        
                        console.log(chalk.green('\n\n!!!success: ', resolvedFile, '\n\n'));
                        
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
            promise = resolveGlobImport(url, prev);
        } else {
            promise = resolveSingleImport(url, prev)
        }
        return promise;
    }
    
    
    // starts with ./ or ../
    const startsRelativeRE = /^\.?\.\//;
    
    function resolveSingleImport(url, prev){
        
        // TODO: Check if the leading directory is a known project and prepend '~#'
        
        
        if (startsRelativeRE.test(url)){
            // all good
        } else {
            // Try to resolve to a known module with ~# prefix.
            url = pathToKnownModule(url);
        }
        
        let possibleImports = importsToResolve(url);
        
        console.log(`possibleImports=\n${ possibleImports.join('\n') }\n\n`);
        
        return startResolving(
            dirContextFrom(prev),
            possibleImports
        );
    }
    
    
    const glob = require('glob');
    const fs = require("fs");
    const _path = path.posix;
    
    function resolveGlobImport(url, prev){
        
        let promise;
        
        let basePrev = dirContextFrom(prev);
        let globPattern = path.basename(url);   // *.scss?
        const globPath = path.dirname(url);
        
        let resolveGlobPath = globPath;
        let isModule = false;
        
        let result;
        
        // starts with ./ or ../
        if (startsRelativeRE.test(globPath)){
            // Leave as-is
        } else {
            let relPath = _path.join(basePrev, globPath);
            
            // Not an explicitly relative path
            console.log(chalk.yellow(`trying: ${relPath}`));
            
            if (fs.existsSync(relPath)){
                // Resolve glob against relative path
                resolveGlobPath = './'+globPath;
                isModule = true;
                
                console.log(chalk.green('Matched valid path'));
            } else {
                /**
                 * Get the first part of the globPath and see if it matches
                 * a known/configured bower module.
                 */
                // TODO: Split of any '~#' as well
                resolveGlobPath = prependDepPath(globPath);
                
                if (false){
                    // some kind of fallback... or throw an error?
                    // CORIDYN: Implement this bit - check if we should be trying to resolve against a module.
                    
                    console.log(chalk.red(`\n!!!(resolveGlobImport) could not match glob against any known projects!!!\nglobPath="${globPath}"\ndeps=${JSON.stringify(deps, null, 2)}`));
                }
            }
        }
        
        
        if (startsRelativeRE.test(resolveGlobPath)){
            let globContext = _path.join(basePrev, resolveGlobPath);
            
            // Resolve pattern relative to `basePrev`
            result = glob.sync(
                '*.scss',
                {
                    cwd: globContext,
                    nodir: true,
                }
            );
            
            // // Join the glob context together
            // result = result.map((p) => path.join(globContext, p));
            
            // Join the glob context together
            // if (isModule){
            //     // Make globs relative to calling file (`prev`)
            //     result = result.map((p) => _path.join('./', globPath, p));
            // } else {
                // Output paths prefixed with './'
                result = result.map((p) => _path.join(globContext, p));
            // }
        } else {
            // resolve to module directory first,
            // then make relative to that dir
            
            /*
            @import "test/*" =>
                
                ./test/*
                ~#test/*
            
            */
            
            promise = Promise.reject('Not implemented yet');
        }
        
        // TODO: Handle empty array
        if (result && result.length){
            
            let contents = [`/* dir="${basePrev}" pattern="${url}" */`]
                .concat(
                    // Prepend with '~' to treat as-is...?
                    result.map(p => `@import "${p}";`)
                ).join('\n');
            
            // Resolve with a "virtual file"
            promise = Promise.resolve({
                contents: contents
            });
            
            console.log(`\nvirtual glob file=\n${contents}`);
            
        } else {
            promise = Promise.reject();
            console.log(`\n\nresult=\n${result}`);
        }
        
        return promise;
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
        // TODO: Split off any '~#' as well
        
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
            // If it does then resolve the glob against that module path.
            let depPath = depEntry.path;
            
            // Prepend our special module chars
            result = '~#' + candidatePath;
        }
        
        return result;
    }
    // End of custom wiwo
    

    return (url, prev, done) => {
        console.log(chalk.cyan(`\nurl=${ url }\nprev=${ prev }`));
        
        wiwoResolve(    url, prev)
         // Catch all resolving errors, return the original file and pass responsibility back to other custom importers
            .catch(() => ({ file: url }))
            .then(done);
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
